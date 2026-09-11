package service

// ---------------------------------------------------------------------------
// Groq provider (OpenAI-compatible API)
// ---------------------------------------------------------------------------

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func (s *AIService) getGroqKeys() []string {
	keysStr := os.Getenv("GROQ_API_KEYS")
	if keysStr == "" {
		return nil
	}
	parts := strings.Split(keysStr, ",")
	var keys []string
	for _, p := range parts {
		k := strings.TrimSpace(p)
		if k != "" {
			keys = append(keys, k)
		}
	}
	return keys
}

func (s *AIService) askGroqWithRotation(question string, history []AIConversationMessage, snapshot *AISnapshot, isConversation bool, candidateTools ...[]AIToolName) (string, string, error) {
	keys := s.getGroqKeys()
	if len(keys) == 0 {
		return "", "", errors.New("GROQ_API_KEY is not configured")
	}

	attempts, releaseAt := nextProviderAttempts(&s.keyHealth, "groq", keys, &s.groqKeyIndex)
	if len(attempts) == 0 {
		return "", "", allKeysRateLimitedError("Groq", len(keys), releaseAt)
	}

	var lastErr error

	for _, attempt := range attempts {
		currentKey := attempt.Key

		var answer, model string
		var err error

		if isConversation {
			answer, model, err = s.executeGroqConversation(question, history, currentKey)
		} else {
			var allowed []AIToolName
			if len(candidateTools) > 0 {
				allowed = candidateTools[0]
			}
			answer, model, err = s.executeGroq(question, history, *snapshot, currentKey, allowed)
		}

		if err == nil {
			s.keyHealth.clear("groq", attempt.Index)
			return answer, model, nil
		}

		lastErr = err
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Groq: %v — skipping remaining keys", err)
			return "", "", err
		}
		if errors.Is(err, errRateLimit) {
			wait := retryAfterOf(err)
			s.keyHealth.park("groq", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Groq key %s rate limited → parked for %s", attempt.Label(), wait.Round(time.Second))
			continue
		}
		aiStage("warn", "Groq key %s failed: %v → rotating", attempt.Label(), err)
	}

	return "", "", lastErr
}

func (s *AIService) executeClassifierGroq(question string, history []AIConversationMessage, apiKey string) (string, error) {
	model := strings.TrimSpace(os.Getenv("GROQ_MODEL"))
	if model == "" {
		model = "openai/gpt-oss-20b"
	}
	aiStage("call", "Groq classifier model=%s", model)

	prompt := fmt.Sprintf(routerClassifierTemplate, conversationPrompt(routerHistory(history)), question)

	payload := groqRequest{
		Model: model,
		Messages: []groqMessage{
			{Role: "user", Content: prompt},
		},
		Temperature: zeroTemperature(), // deterministic routing
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequest(http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if statusErr := classifyProviderResponse("Groq", "classifier", model, resp); statusErr != nil {
		return "", statusErr
	}

	var parsed groqResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) > 0 {
		return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
	}
	return "", errors.New("groq returned empty classifier response")
}

func (s *AIService) executeGroq(question string, history []AIConversationMessage, snapshot AISnapshot, apiKey string, candidateTools []AIToolName) (string, string, error) {
	model := strings.TrimSpace(os.Getenv("GROQ_MODEL"))
	if model == "" {
		model = "openai/gpt-oss-20b"
	}
	aiStage("call", "Groq analytical model=%s", model)

	prompt, err := analyticalPrompt(question, history, snapshot)
	if err != nil {
		return "", "", err
	}

	payload := groqRequest{
		Model: model,
		Messages: []groqMessage{
			{Role: "user", Content: prompt},
		},
		Tools: s.getGroqToolsForCandidates(candidateTools),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}

	httpReq, err := http.NewRequest(http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if statusErr := classifyProviderResponse("Groq", "analytical request", model, resp); statusErr != nil {
		return "", "", statusErr
	}

	var parsed groqResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", "", err
	}
	if len(parsed.Choices) > 0 {
		msg := parsed.Choices[0].Message
		if len(msg.ToolCalls) > 0 {
			if len(msg.ToolCalls) != 1 {
				return "", "", errors.New("Groq returned more than one tool call")
			}
			toolName, err := validateGroqReadOnlyToolCall(msg.ToolCalls[0])
			if err != nil {
				return "", "", err
			}
			return fmt.Sprintf("CALL_TOOL:%s", toolName), model, nil
		}
		return msg.Content, model, nil
	}
	return "", "", errors.New("groq returned an empty response")
}

func (s *AIService) executeGroqConversation(question string, history []AIConversationMessage, apiKey string) (string, string, error) {
	model := strings.TrimSpace(os.Getenv("GROQ_MODEL"))
	if model == "" {
		model = "openai/gpt-oss-20b"
	}
	aiStage("call", "Groq conversation model=%s", model)

	prompt := fmt.Sprintf(conversationPersonaTemplate, question, conversationPrompt(history))

	payload := groqRequest{
		Model: model,
		Messages: []groqMessage{
			{Role: "user", Content: prompt},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}

	httpReq, err := http.NewRequest(http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if statusErr := classifyProviderResponse("Groq", "conversation request", model, resp); statusErr != nil {
		return "", "", statusErr
	}

	var parsed groqResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", "", err
	}
	if len(parsed.Choices) > 0 {
		return parsed.Choices[0].Message.Content, model, nil
	}
	return "", "", errors.New("groq returned an empty response")
}

func (s *AIService) getGroqTools() []groqTool {
	return []groqTool{
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_lowest_margin_menu",
				Description: "Get details about the menu item with the lowest profit margin.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_highest_margin_menu",
				Description: "Get details about the menu item with the highest profit margin.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_low_stock_ingredients",
				Description: "Get the list of ingredients that are currently low in stock or out of stock.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_top_selling_menus",
				Description: "Get the list of top-selling menus ranked by popularity and revenue.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_inventory_valuation",
				Description: "Get the summary of the total inventory value and metrics.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_sales_summary",
				Description: fmt.Sprintf("Get the verified total revenue and order count in the recent %.0f-day analysis period.", analysisWindowDays),
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_lowest_cost_menu",
				Description: "Get the menu item with the lowest ingredient cost per dish.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_sales_trend",
				Description: "Compare the last 7 days of sales against the previous 7 days to show the revenue trend.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_average_order_value",
				Description: "Get the average revenue per order (average check size) over the recent analysis period.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_order_type_breakdown",
				Description: "Get the revenue and order split by order type (dine-in, takeaway, delivery).",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_menu_revenue_ranking",
				Description: "Get the menus ranked by total revenue generated (not by quantity sold).",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_peak_periods",
				Description: "Get the busiest day of the week and busiest hour of the day by order count.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_slow_moving_menus",
				Description: "Get the menus with the fewest sales (including none) that may be candidates for removal.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_menu_engineering",
				Description: "Classify menus by popularity and margin into Star / Plowhorse / Puzzle / Dog quadrants.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_ingredient_reorder_forecast",
				Description: "Estimate which ingredients will run out soon based on their usage rate over the analysis window.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_dead_stock",
				Description: "List ingredients that hold stock but were not used at all in the window (tied-up cash / spoilage risk).",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_top_cost_ingredients",
				Description: "Rank ingredients by total cost consumed in the analysis window.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_store_summary",
				Description: "Backend-composed overall store overview (sales, trend, top menus, best margin, low stock) for broad summary requests.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_sales_for_period",
				Description: "Sales for a specific period named by the user: today, yesterday, last 7 days, or the previous week.",
				Parameters:  groqParameters{Type: "object"},
			},
		},
		{
			Type: "function",
			Function: groqFunctionShortcut{
				Name:        "get_most_expensive_menu",
				Description: "The menu items with the highest listed price per dish (menu price, not revenue).",
				Parameters:  groqParameters{Type: "object"},
			},
		},
	}
}

func validateGroqReadOnlyToolCall(call groqToolCall) (AIToolName, error) {
	toolName := AIToolName(strings.TrimSpace(call.Function.Name))
	if !isProviderSnapshotTool(toolName) {
		return "", errors.New("Groq requested an unsupported tool")
	}
	arguments := strings.TrimSpace(call.Function.Arguments)
	if arguments == "" {
		arguments = "{}"
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal([]byte(arguments), &decoded); err != nil || decoded == nil {
		return "", errors.New("Groq returned invalid tool arguments")
	}
	if len(decoded) != 0 {
		return "", errors.New("Groq supplied arguments to a no-argument tool")
	}
	return toolName, nil
}

func (s *AIService) getGroqToolsForCandidates(candidates []AIToolName) []groqTool {
	if len(candidates) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		allowed[string(candidate)] = struct{}{}
	}
	all := s.getGroqTools()
	filtered := make([]groqTool, 0, len(candidates))
	for _, tool := range all {
		if _, ok := allowed[tool.Function.Name]; ok {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

// groqReasoningEffortModels lists the models that accept reasoning_effort with
// low/medium/high. Only gpt-oss takes those three; qwen3 uses none/default and
// everything else rejects the field, so the model has to be checked rather than
// the parameter sent blindly — GROQ_MODEL is an environment variable and can be
// pointed at anything.
var groqReasoningEffortModels = map[string]struct{}{
	"openai/gpt-oss-20b":  {},
	"openai/gpt-oss-120b": {},
}

// groqReasoningEffortFor decides whether the caller's preference can be sent.
// An empty preference, or a model that does not take the parameter, produces no
// field at all — which is how every caller except joyboy reaches Groq, so their
// requests carry exactly the bytes they carried before this existed.
//
// An earlier version pinned "low" here for everyone. That was measured as a win
// on writing (no reply hit the ceiling again, and latency halved) and a loss on
// judgement: asked "เมนูไหนขายดีแต่กำไรน้อย" twice the model picked the right tool
// once, and the wrong run then asserted an answer the tool could not support.
// Joyboy makes both kinds of call, so the choice belongs to the caller that
// knows which one it is making, not to this function.
func groqReasoningEffortFor(model, preference string) *string {
	preference = strings.TrimSpace(preference)
	if preference == "" {
		return nil
	}
	if _, supported := groqReasoningEffortModels[strings.TrimSpace(model)]; !supported {
		return nil
	}
	return &preference
}

// positiveOrNil turns an unset ceiling (zero) into a nil pointer so omitempty
// drops the key, and any positive value into a pointer that is sent. It keeps
// the "zero means default" contract of aiProviderCompleteOptions intact at the
// wire.
func positiveOrNil(n int) *int {
	if n <= 0 {
		return nil
	}
	return &n
}

func (s *AIService) executeSecondRoundGroq(prompt string, apiKey string, opts aiProviderCompleteOptions) (string, string, error) {
	model := strings.TrimSpace(os.Getenv("GROQ_MODEL"))
	if model == "" {
		model = "openai/gpt-oss-20b"
	}
	aiStage("call", "Groq second-round model=%s", model)
	started := time.Now()
	payload := groqRequest{
		Model: model,
		Messages: []groqMessage{
			{Role: "user", Content: prompt},
		},
		ReasoningEffort:     groqReasoningEffortFor(model, opts.ReasoningEffort),
		MaxCompletionTokens: positiveOrNil(opts.MaxCompletionTokens),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	httpReq, err := http.NewRequest(http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if statusErr := classifyProviderResponse("Groq", "second-round request", model, resp); statusErr != nil {
		return "", "", statusErr
	}
	var parsed groqResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", "", err
	}
	if len(parsed.Choices) > 0 {
		choice := parsed.Choices[0]
		// Reported, not acted on. No ceiling is sent yet, so this is the
		// measurement that has to come first: how much a reply actually costs,
		// and how often the provider default cuts one off. Counts only, no
		// content, so it is safe outside AI_DEBUG.
		if choice.FinishReason == "length" {
			aiStage("warn", "Groq second-round hit the output ceiling → the answer is cut off (completion_tokens=%d reasoning_tokens=%d)",
				parsed.Usage.CompletionTokens, parsed.Usage.CompletionTokensDetails.ReasoningTokens)
		} else {
			aiStage("usage", "Groq second-round took=%dms finish=%s completion_tokens=%d reasoning_tokens=%d prompt_tokens=%d cached_tokens=%d",
				time.Since(started).Milliseconds(), choice.FinishReason, parsed.Usage.CompletionTokens,
				parsed.Usage.CompletionTokensDetails.ReasoningTokens, parsed.Usage.PromptTokens,
				parsed.Usage.PromptTokensDetails.CachedTokens)
		}
		return choice.Message.Content, model, nil
	}
	return "", "", errors.New("groq second round returned empty response")
}

func (s *AIService) askSecondRoundGroqWithRotation(prompt string, opts aiProviderCompleteOptions) (string, string, error) {
	keys := s.getGroqKeys()
	if len(keys) == 0 {
		return "", "", errors.New("GROQ_API_KEY is not configured")
	}
	attempts, releaseAt := nextProviderAttempts(&s.keyHealth, "groq", keys, &s.groqKeyIndex)
	if len(attempts) == 0 {
		return "", "", allKeysRateLimitedError("Groq second-round", len(keys), releaseAt)
	}
	var lastErr error
	for _, attempt := range attempts {
		answer, model, err := s.executeSecondRoundGroq(prompt, attempt.Key, opts)
		if err == nil {
			s.keyHealth.clear("groq", attempt.Index)
			return answer, model, nil
		}
		lastErr = err
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Groq second-round: %v — skipping remaining keys", err)
			return "", "", err
		}
		if errors.Is(err, errRateLimit) {
			wait := retryAfterOf(err)
			s.keyHealth.park("groq", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Groq second-round key %s rate limited → parked for %s", attempt.Label(), wait.Round(time.Second))
			continue
		}
		aiStage("warn", "Groq second-round key %s failed: %v → rotating", attempt.Label(), err)
	}
	return "", "", lastErr
}
