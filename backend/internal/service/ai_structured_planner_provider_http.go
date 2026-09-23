package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	groqStructuredPlannerEndpoint    = "https://api.groq.com/openai/v1/chat/completions"
	geminiStructuredPlannerBaseURL   = "https://generativelanguage.googleapis.com/v1beta/models"
	defaultGroqPlannerModel          = "openai/gpt-oss-20b"
	// gemini-2.5-flash is being retired: a newly issued key answers
	// 404 "no longer available to new users ... use models/gemini-3.5-flash-lite",
	// and the two models bill against separate quota buckets, so the switch also
	// restored capacity on keys that were already exhausted.
	defaultGeminiPlannerModel        = "gemini-3.5-flash-lite"
	structuredPlannerHTTPBodyLimit   = 1 << 20
	structuredPlannerHTTPTimeout     = 30 * time.Second
	// The plan itself is about 300 tokens, but reasoning-style models spend a far
	// larger budget before emitting it. Live runs showed gpt-oss-20b stopping at
	// exactly 2048 output tokens and returning truncated JSON, which the parser
	// then rejected — the provider looked broken when it had simply run out of
	// room. Only tokens actually produced are billed, so the headroom is free.
	// Groq reserves prompt + max_completion_tokens against the daily token
	// budget before the call runs: a 429 body states "Requested 8675" for a
	// 4,580-token prompt asking for 4,095 completion tokens. The budget is
	// 200,000 tokens per DAY for the whole organisation, so every unused
	// completion token asked for is a planning call that cannot happen today.
	// The largest plan measured across every live run is 2,111 tokens, so this
	// keeps a wide margin over that while buying back roughly a sixth of the
	// day's calls. Raising it again is a capacity decision, not a free one.
	structuredPlannerMaxOutputTokens = 3072
)

// groqStrictStructuredPlannerModels lists the Groq models that accept
// response_format=json_schema with strict:true. Models outside this list still
// work through JSON object mode, where the schema is carried in the prompt
// instead of enforced by the provider.
//
// openai/gpt-oss-20b was removed after measurement: Groq accepts the schema but
// the model cannot generate output that satisfies it, so every planner request
// came back as HTTP 400 json_validate_failed and the provider never produced a
// plan at all. The same request in JSON object mode answers 200, and the backend
// still runs Normalize/Validate over the result, so nothing is trusted that was
// not checked here.
var groqStrictStructuredPlannerModels = map[string]struct{}{
	"openai/gpt-oss-120b":                       {},
	"moonshotai/kimi-k2-instruct-0905":          {},
	"meta-llama/llama-4-scout-17b-16e-instruct":  {},
	"meta-llama/llama-4-maverick-17b-128e-instruct": {},
}

// jsonObjectPlannerInstruction is appended to the system prompt when the chosen
// model cannot have the schema enforced by the provider. The backend still
// normalises and validates the result, so this only has to get the model close.
const jsonObjectPlannerInstruction = `
You MUST reply with a single JSON object and nothing else — no markdown fences, no commentary.
The object MUST conform exactly to this JSON Schema (every "required" field must be present,
and no property outside "properties" is allowed):

%s`

// NewGroqStructuredPlannerProvider creates the hosted Groq implementation of
// StructuredPlannerProvider. Keys are copied so callers may safely reuse or
// clear their input slice after construction.
func NewGroqStructuredPlannerProvider(client *http.Client, apiKeys []string, health *providerKeyHealth) StructuredPlannerProvider {
	provider := newGroqStructuredPlannerProvider(client, apiKeys, groqStructuredPlannerEndpoint)
	provider.health = health
	return provider
}

// NewGeminiStructuredPlannerProvider creates the hosted Gemini implementation
// of StructuredPlannerProvider. It is intentionally not connected to
// AIService yet; the planner can be integrated after its evaluation gate is in
// place.
func NewGeminiStructuredPlannerProvider(client *http.Client, apiKeys []string, health *providerKeyHealth) StructuredPlannerProvider {
	provider := newGeminiStructuredPlannerProvider(client, apiKeys, geminiStructuredPlannerBaseURL)
	provider.health = health
	return provider
}

type groqStructuredPlannerProvider struct {
	client   *http.Client
	apiKeys  []string
	endpoint string
	keyIndex uint32
	// health is shared with the rest of the assistant so a key parked by one
	// flow is skipped by the other. Nil is valid: the provider then behaves as
	// it did before, trying every key on every call.
	health *providerKeyHealth
}

var _ StructuredPlannerProvider = (*groqStructuredPlannerProvider)(nil)

func newGroqStructuredPlannerProvider(client *http.Client, apiKeys []string, endpoint string) *groqStructuredPlannerProvider {
	return &groqStructuredPlannerProvider{
		client:   structuredPlannerHTTPClient(client),
		apiKeys:  normalizedStructuredPlannerKeys(apiKeys),
		endpoint: strings.TrimSpace(endpoint),
	}
}

func (p *groqStructuredPlannerProvider) Name() StructuredPlannerProviderName {
	return StructuredPlannerProviderGroq
}

func (p *groqStructuredPlannerProvider) GenerateResolvedPlan(ctx context.Context, request StructuredPlannerProviderRequest) (StructuredPlannerProviderResponse, error) {
	if p == nil {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner provider is nil")
	}
	if err := validateStructuredPlannerProviderRequest(ctx, request); err != nil {
		return StructuredPlannerProviderResponse{}, err
	}
	if len(p.apiKeys) == 0 {
		return StructuredPlannerProviderResponse{}, errors.New("GROQ_API_KEYS is not configured")
	}
	if p.endpoint == "" {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner endpoint is not configured")
	}

	// Prefer a planner-specific model, then the model the rest of the assistant
	// already uses, so one GROQ_MODEL setting drives both flows.
	model := structuredPlannerModelChain("GROQ_PLANNER_MODEL", "GROQ_MODEL", defaultGroqPlannerModel)

	systemPrompt := request.SystemPrompt
	responseFormat := groqStructuredPlannerResponseFormat{Type: "json_object"}
	if _, strictSupported := groqStrictStructuredPlannerModels[model]; strictSupported {
		responseFormat = groqStructuredPlannerResponseFormat{
			Type: "json_schema",
			JSONSchema: &groqStructuredPlannerSchema{
				Name:   strings.TrimSpace(request.SchemaName),
				Strict: true,
				Schema: sanitizeSchemaForGroqStrict(request.JSONSchema),
			},
		}
	} else {
		// The provider will not police the shape, so state it in the prompt and
		// rely on the backend's Normalize/Validate to reject anything off-contract.
		schemaJSON, marshalErr := json.Marshal(request.JSONSchema)
		if marshalErr != nil {
			return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner schema could not be encoded")
		}
		systemPrompt = strings.TrimSpace(systemPrompt) + "\n" + fmt.Sprintf(jsonObjectPlannerInstruction, schemaJSON)
	}

	payload, err := json.Marshal(groqStructuredPlannerRequest{
		Model:               model,
		MaxCompletionTokens: structuredPlannerMaxOutputTokens,
		Messages: []groqStructuredPlannerMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: request.UserPrompt},
		},
		ResponseFormat: responseFormat,
	})
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner request could not be encoded")
	}

	return runPlannerKeyRotation(ctx, plannerRotation{
		provider: "groq",
		label:    "Groq structured planner",
		health:   p.health,
		keys:     p.apiKeys,
		cursor:   &p.keyIndex,
		model:    model,
		call: func(ctx context.Context, key string) (StructuredPlannerProviderResponse, error) {
			return p.generateWithKey(ctx, payload, key, model)
		},
	})
}

func (p *groqStructuredPlannerProvider) generateWithKey(ctx context.Context, payload []byte, apiKey string, model string) (StructuredPlannerProviderResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(payload))
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner request could not be created")
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return StructuredPlannerProviderResponse{}, ctxErr
		}
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner transport failed")
	}
	defer resp.Body.Close()

	body, tooLarge, err := readStructuredPlannerHTTPBody(resp.Body)
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner response could not be read")
	}
	// Share the assistant's status vocabulary: a 404 means the configured model
	// is gone (no key can fix it) and a 429 carries the wait the provider asked
	// for, so the rotation below can park that key instead of rediscovering it.
	if statusErr := classifyProviderResponse("Groq", "structured planner", model, resp); statusErr != nil {
		logProviderRejection("Groq", model, resp.StatusCode, body)
		return StructuredPlannerProviderResponse{}, statusErr
	}
	if tooLarge {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner response exceeded the size limit")
	}

	var decoded groqStructuredPlannerResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner returned an invalid response")
	}
	for _, choice := range decoded.Choices {
		rawJSON := strings.TrimSpace(choice.Message.Content)
		if rawJSON == "" {
			continue
		}
		return StructuredPlannerProviderResponse{
			RawJSON:      rawJSON,
			Model:        model,
			InputTokens:  maxPlannerUsage(decoded.Usage.PromptTokens),
			OutputTokens: maxPlannerUsage(decoded.Usage.CompletionTokens),
		}, nil
	}

	return StructuredPlannerProviderResponse{}, errors.New("Groq structured planner returned no JSON content")
}

type groqStructuredPlannerRequest struct {
	Model               string                              `json:"model"`
	Messages            []groqStructuredPlannerMessage      `json:"messages"`
	ResponseFormat      groqStructuredPlannerResponseFormat `json:"response_format"`
	MaxCompletionTokens int                                 `json:"max_completion_tokens"`
}

type groqStructuredPlannerMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type groqStructuredPlannerResponseFormat struct {
	Type string `json:"type"`
	// Omitted entirely in JSON object mode; an empty json_schema is rejected.
	JSONSchema *groqStructuredPlannerSchema `json:"json_schema,omitempty"`
}

type groqStructuredPlannerSchema struct {
	Name   string         `json:"name"`
	Strict bool           `json:"strict"`
	Schema map[string]any `json:"schema"`
}

type groqStructuredPlannerResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type geminiStructuredPlannerProvider struct {
	client   *http.Client
	apiKeys  []string
	baseURL  string
	keyIndex uint32
	health   *providerKeyHealth
}

var _ StructuredPlannerProvider = (*geminiStructuredPlannerProvider)(nil)

func newGeminiStructuredPlannerProvider(client *http.Client, apiKeys []string, baseURL string) *geminiStructuredPlannerProvider {
	return &geminiStructuredPlannerProvider{
		client:  structuredPlannerHTTPClient(client),
		apiKeys: normalizedStructuredPlannerKeys(apiKeys),
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
	}
}

func (p *geminiStructuredPlannerProvider) Name() StructuredPlannerProviderName {
	return StructuredPlannerProviderGemini
}

func (p *geminiStructuredPlannerProvider) GenerateResolvedPlan(ctx context.Context, request StructuredPlannerProviderRequest) (StructuredPlannerProviderResponse, error) {
	if p == nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner provider is nil")
	}
	if err := validateStructuredPlannerProviderRequest(ctx, request); err != nil {
		return StructuredPlannerProviderResponse{}, err
	}
	if len(p.apiKeys) == 0 {
		return StructuredPlannerProviderResponse{}, errors.New("GEMINI_API_KEYS is not configured")
	}
	if p.baseURL == "" {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner endpoint is not configured")
	}

	model := structuredPlannerModelChain("GEMINI_PLANNER_MODEL", "GEMINI_MODEL", defaultGeminiPlannerModel)

	// Gemini rejects this schema outright: its constrained decoder reports
	// "the specified schema produces a constraint that has too many states for
	// serving" — the plan has ~20 tool enum values, nested arrays and numeric
	// bounds, which blows up its state machine regardless of byte size. Asking
	// for JSON and describing the shape in the prompt is accepted, and the
	// backend still normalises and validates every plan.
	schemaJSON, marshalErr := json.Marshal(request.JSONSchema)
	if marshalErr != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner schema could not be encoded")
	}
	systemPrompt := strings.TrimSpace(request.SystemPrompt) + "\n" + fmt.Sprintf(jsonObjectPlannerInstruction, schemaJSON)

	payload, err := json.Marshal(geminiStructuredPlannerRequest{
		SystemInstruction: geminiStructuredPlannerContent{
			Parts: []geminiStructuredPlannerPart{{Text: systemPrompt}},
		},
		Contents: []geminiStructuredPlannerContent{{
			Role:  "user",
			Parts: []geminiStructuredPlannerPart{{Text: request.UserPrompt}},
		}},
		GenerationConfig: geminiStructuredPlannerGenerationConfig{
			ResponseMIMEType: "application/json",
			MaxOutputTokens:  structuredPlannerMaxOutputTokens,
		},
	})
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner request could not be encoded")
	}

	endpoint := p.baseURL + "/" + url.PathEscape(model) + ":generateContent"
	return runPlannerKeyRotation(ctx, plannerRotation{
		provider: "gemini",
		label:    "Gemini structured planner",
		health:   p.health,
		keys:     p.apiKeys,
		cursor:   &p.keyIndex,
		model:    model,
		call: func(ctx context.Context, key string) (StructuredPlannerProviderResponse, error) {
			return p.generateWithKey(ctx, payload, key, endpoint, model)
		},
	})
}

func (p *geminiStructuredPlannerProvider) generateWithKey(ctx context.Context, payload []byte, apiKey string, endpoint string, model string) (StructuredPlannerProviderResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner request could not be created")
	}
	req.Header.Set("x-goog-api-key", apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return StructuredPlannerProviderResponse{}, ctxErr
		}
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner transport failed")
	}
	defer resp.Body.Close()

	body, tooLarge, err := readStructuredPlannerHTTPBody(resp.Body)
	if err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner response could not be read")
	}
	if statusErr := classifyProviderResponse("Gemini", "structured planner", model, resp); statusErr != nil {
		logProviderRejection("Gemini", model, resp.StatusCode, body)
		return StructuredPlannerProviderResponse{}, statusErr
	}
	if tooLarge {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner response exceeded the size limit")
	}

	var decoded geminiStructuredPlannerResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner returned an invalid response")
	}
	for _, candidate := range decoded.Candidates {
		var content strings.Builder
		for _, part := range candidate.Content.Parts {
			content.WriteString(part.Text)
		}
		rawJSON := strings.TrimSpace(content.String())
		if rawJSON == "" {
			continue
		}
		return StructuredPlannerProviderResponse{
			RawJSON:      rawJSON,
			Model:        model,
			InputTokens:  maxPlannerUsage(decoded.UsageMetadata.PromptTokenCount),
			OutputTokens: maxPlannerUsage(decoded.UsageMetadata.CandidatesTokenCount),
		}, nil
	}

	return StructuredPlannerProviderResponse{}, errors.New("Gemini structured planner returned no JSON content")
}

type geminiStructuredPlannerRequest struct {
	SystemInstruction geminiStructuredPlannerContent          `json:"systemInstruction"`
	Contents          []geminiStructuredPlannerContent        `json:"contents"`
	GenerationConfig  geminiStructuredPlannerGenerationConfig `json:"generationConfig"`
}

type geminiStructuredPlannerGenerationConfig struct {
	ResponseMIMEType string `json:"responseMimeType"`
	// responseJsonSchema is deliberately omitted: Gemini rejects the plan schema
	// as having "too many states for serving". The shape is described in the
	// system prompt instead.
	ResponseJSONSchema map[string]any `json:"responseJsonSchema,omitempty"`
	MaxOutputTokens    int            `json:"maxOutputTokens"`
}

type geminiStructuredPlannerContent struct {
	Role  string                        `json:"role,omitempty"`
	Parts []geminiStructuredPlannerPart `json:"parts"`
}

type geminiStructuredPlannerPart struct {
	Text string `json:"text"`
}

type geminiStructuredPlannerResponse struct {
	Candidates []struct {
		Content geminiStructuredPlannerContent `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
	} `json:"usageMetadata"`
}

func validateStructuredPlannerProviderRequest(ctx context.Context, request StructuredPlannerProviderRequest) error {
	if ctx == nil {
		return errors.New("structured planner provider context is nil")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(request.SchemaName) == "" {
		return errors.New("structured planner provider schema name is required")
	}
	if strings.TrimSpace(request.SystemPrompt) == "" {
		return errors.New("structured planner provider system prompt is required")
	}
	if strings.TrimSpace(request.UserPrompt) == "" {
		return errors.New("structured planner provider user prompt is required")
	}
	if request.JSONSchema == nil {
		return errors.New("structured planner provider JSON schema is required")
	}
	return nil
}

func structuredPlannerHTTPClient(client *http.Client) *http.Client {
	if client != nil {
		clone := *client
		if clone.Timeout <= 0 || clone.Timeout > structuredPlannerHTTPTimeout {
			clone.Timeout = structuredPlannerHTTPTimeout
		}
		return &clone
	}
	return &http.Client{Timeout: structuredPlannerHTTPTimeout}
}

func normalizedStructuredPlannerKeys(keys []string) []string {
	normalized := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, key)
	}
	return normalized
}

// structuredPlannerModelChain resolves the planner model from the most specific
// setting to the least: a planner-only override, then the model the rest of the
// assistant already uses, then the built-in default. This keeps one model
// setting in .env driving both the legacy flow and the planner.
func structuredPlannerModelChain(plannerEnvironment, sharedEnvironment, fallback string) string {
	if configured := strings.TrimSpace(os.Getenv(plannerEnvironment)); configured != "" {
		return configured
	}
	if configured := strings.TrimSpace(os.Getenv(sharedEnvironment)); configured != "" {
		return configured
	}
	return fallback
}

func readStructuredPlannerHTTPBody(reader io.Reader) ([]byte, bool, error) {
	limited := io.LimitReader(reader, structuredPlannerHTTPBodyLimit+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, false, err
	}
	if len(body) > structuredPlannerHTTPBodyLimit {
		return nil, true, nil
	}
	return body, false, nil
}

func structuredPlannerHTTPStatusError(provider string, statusCode int) error {
	err := &structuredPlannerProviderHTTPError{Provider: provider, StatusCode: statusCode}
	if statusCode == http.StatusTooManyRequests {
		err.Cause = errRateLimit
	}
	return err
}

type structuredPlannerProviderHTTPError struct {
	Provider   string
	StatusCode int
	Cause      error
}

func (e *structuredPlannerProviderHTTPError) Error() string {
	if e.StatusCode == http.StatusTooManyRequests {
		return fmt.Sprintf("%s structured planner was rate limited: %v", e.Provider, e.Cause)
	}
	return fmt.Sprintf("%s structured planner returned HTTP status %d", e.Provider, e.StatusCode)
}

func (e *structuredPlannerProviderHTTPError) Unwrap() error { return e.Cause }

// structuredPlannerShouldTryNextKey reports whether a failure is this key's
// fault rather than the request's, so the rotation should move on to the next
// key instead of giving up.
//
// It has to match *aiProviderHTTPError, because that is the type that actually
// arrives. Both provider paths classify their responses through
// classifyProviderResponse (ai_provider_health.go), which returns
// *rateLimitedError for 429, model-unavailable for 404, and *aiProviderHTTPError
// for everything else - 401 and 403 included. This used to look only for
// *structuredPlannerProviderHTTPError, which nothing constructs outside a helper
// that is itself unreachable, so it always returned false: a single revoked key
// ended the rotation and the remaining keys were never tried, surfacing as
// "exhausted configured API keys" after one attempt.
//
// 429 never reaches here - runPlannerKeyRotation handles errRateLimit first and
// parks the key - but it stays listed so the predicate is correct on its own.
func structuredPlannerShouldTryNextKey(err error) bool {
	if errors.Is(err, errKeyRejected) {
		return true
	}
	var plannerErr *structuredPlannerProviderHTTPError
	if errors.As(err, &plannerErr) {
		return keyScopedProviderStatus(plannerErr.StatusCode)
	}
	var providerErr *aiProviderHTTPError
	if errors.As(err, &providerErr) {
		return keyScopedProviderStatus(providerErr.StatusCode)
	}
	return false
}

// keyScopedProviderStatus is true for the statuses that another key could
// plausibly answer differently.
func keyScopedProviderStatus(statusCode int) bool {
	return statusCode == http.StatusUnauthorized ||
		statusCode == http.StatusForbidden ||
		statusCode == http.StatusTooManyRequests
}

// Gemini supports a deliberate subset of JSON Schema. The backend still runs
// the complete ResolvedPlan validator, so removing unsupported hint keywords
// here improves provider compatibility without weakening the execution gate.
func geminiCompatibleJSONSchema(schema map[string]any) map[string]any {
	stripped, _ := stripGeminiUnsupportedSchemaKeywords(schema).(map[string]any)
	return stripped
}

func stripGeminiUnsupportedSchemaKeywords(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			switch key {
			case "const", "pattern", "uniqueItems", "minLength", "maxLength", "minimum", "maximum":
				continue
			default:
				result[key] = stripGeminiUnsupportedSchemaKeywords(child)
			}
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = stripGeminiUnsupportedSchemaKeywords(child)
		}
		return result
	default:
		return value
	}
}

// groqUnsupportedSchemaKeywords are JSON Schema keywords that Groq's strict
// json_schema mode rejects with HTTP 400 ("uniqueItems is not supported"),
// failing the whole provider before the model is ever reached. Every keyword
// here is a constraint the backend re-checks after parsing — Normalize/Validate
// already reject duplicate metrics, group_by, entities and filters — so dropping
// them from the wire schema changes what the provider is asked to enforce, not
// what the backend accepts.
var groqUnsupportedSchemaKeywords = map[string]struct{}{
	"uniqueItems": {},
}

// sanitizeSchemaForGroqStrict deep-copies the schema without the keywords Groq
// refuses. The copy matters: the same schema value is handed to the next
// provider in the fallback chain, which must still see the full contract.
func sanitizeSchemaForGroqStrict(schema map[string]any) map[string]any {
	if schema == nil {
		return nil
	}
	sanitized := make(map[string]any, len(schema))
	for key, value := range schema {
		if _, unsupported := groqUnsupportedSchemaKeywords[key]; unsupported {
			continue
		}
		sanitized[key] = sanitizeSchemaValueForGroqStrict(value)
	}
	return sanitized
}

func sanitizeSchemaValueForGroqStrict(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeSchemaForGroqStrict(typed)
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, sanitizeSchemaValueForGroqStrict(item))
		}
		return items
	default:
		return value
	}
}

// plannerRotation describes one provider's attempt at producing a plan. It exists
// so both planner adapters share the assistant's key handling instead of each
// keeping a private copy: a key parked after a 429 anywhere is skipped here too,
// and a withdrawn model stops the rotation instead of being retried per key.
type plannerRotation struct {
	provider string // key-health namespace, shared with the chat flows
	label    string // human-readable name for errors
	health   *providerKeyHealth
	keys     []string
	cursor   *uint32
	model    string
	call     func(ctx context.Context, key string) (StructuredPlannerProviderResponse, error)
}

func runPlannerKeyRotation(ctx context.Context, rotation plannerRotation) (StructuredPlannerProviderResponse, error) {
	stats := StructuredPlannerProviderResponse{Model: rotation.model}
	if len(rotation.keys) == 0 {
		return stats, fmt.Errorf("%s has no configured API keys", rotation.label)
	}

	health := rotation.health
	if health == nil {
		// Without a shared tracker the provider still works; it simply cannot
		// remember which keys are cooling down between calls.
		health = &providerKeyHealth{}
	}

	attempts, releaseAt := nextProviderAttempts(health, rotation.provider, rotation.keys, rotation.cursor)
	if len(attempts) == 0 {
		return stats, allKeysRateLimitedError(rotation.label, len(rotation.keys), releaseAt)
	}

	var lastErr error
	for _, attempt := range attempts {
		if err := ctx.Err(); err != nil {
			return StructuredPlannerProviderResponse{}, err
		}
		stats.HTTPAttempts++
		response, callErr := rotation.call(ctx, attempt.Key)
		if callErr == nil {
			health.clear(rotation.provider, attempt.Index)
			response.HTTPAttempts = stats.HTTPAttempts
			response.KeyFallbacks = stats.KeyFallbacks
			response.RateLimits = stats.RateLimits
			return response, nil
		}
		if err := ctx.Err(); err != nil {
			return StructuredPlannerProviderResponse{}, err
		}
		lastErr = callErr

		// A withdrawn model answers the same way on every key.
		if errors.Is(callErr, errModelUnavailable) {
			aiStage("error", "%s: %v — skipping remaining keys", rotation.label, callErr)
			return stats, callErr
		}
		if errors.Is(callErr, errRateLimit) {
			wait := retryAfterOf(callErr)
			health.park(rotation.provider, attempt.Index, time.Now().Add(wait))
			stats.RateLimits++
			aiStage("warn", "%s key %d/%d rate limited → parked for %s",
				rotation.label, attempt.Position, attempt.Total, wait.Round(time.Second))
			if attempt.Position < attempt.Total {
				stats.KeyFallbacks++
			}
			continue
		}
		// A refused key (401/403) is parked for an hour and counts as a
		// fallback, not a rate limit: the next key is what answers, and nothing
		// but a change in .env brings this one back.
		if errors.Is(callErr, errKeyRejected) {
			health.park(rotation.provider, attempt.Index, time.Now().Add(rejectedKeyCooldown))
			aiStage("warn", "%s key %d/%d parked for %s: %v",
				rotation.label, attempt.Position, attempt.Total, rejectedKeyCooldown, callErr)
			stats.KeyFallbacks++
			continue
		}
		if !structuredPlannerShouldTryNextKey(callErr) {
			break
		}
		stats.KeyFallbacks++
	}

	return stats, fmt.Errorf("%s exhausted configured API keys: %w", rotation.label, lastErr)
}

// logProviderRejection prints the reason the provider gave for refusing the
// call. Without it a rejection reads as a bare "provider_call failed": an
// exhausted daily token budget, a withdrawn model and a malformed request all
// look the same, and an investigation into the last one cost hours before the
// message turned out to say "tokens per day (TPD): Limit 200000, Used 198085".
// Only the provider status line is logged, never the prompt or the plan.
func logProviderRejection(provider, model string, status int, body []byte) {
	message := providerErrorMessage(body)
	if message == "" {
		message = "(ไม่มีรายละเอียดจาก provider)"
	}
	aiStage("warn", "%s structured planner ปฏิเสธคำขอ (HTTP %d, model=%s): %s", provider, status, model, message)
}

// providerErrorMessage pulls the human-readable reason out of an OpenAI-shaped
// or Gemini-shaped error body.
func providerErrorMessage(body []byte) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	message := strings.TrimSpace(payload.Error.Message)
	if message == "" {
		message = strings.TrimSpace(payload.Error.Status)
	}
	if runes := []rune(message); len(runes) > 300 {
		message = string(runes[:300]) + "…"
	}
	return message
}
