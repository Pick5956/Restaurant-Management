package service

import (
	"time"

	"Project-M/internal/aitools"
)

type AIIntent string

const (
	AIIntentAnalysis   AIIntent = "analysis"
	AIIntentGreeting   AIIntent = "greeting"
	AIIntentCapability AIIntent = "capabilities"
	AIIntentChat       AIIntent = "conversation"
	AIIntentUnclear    AIIntent = "unclear"
	AIIntentOutOfScope AIIntent = "out_of_scope"
)

type AIAskRequest struct {
	// Digest is server-side memory of this conversation. json:"-" on purpose:
	// a client cannot supply one and never receives one, so nothing a browser
	// sends can be fed back into the assistant's own memory.
	Digest         string                  `json:"-"`
	Question       string                  `json:"question" binding:"required"`
	History        []AIConversationMessage `json:"history"`
	ConversationID string                  `json:"conversation_id,omitempty" binding:"omitempty,max=64"`
	// IngredientCard says the client draws the step-by-step card for a new
	// ingredient (the web, 25 ก.ย. 2569), so "เพิ่มน้ำปลา 2 ขวด" goes straight
	// to a card that asks its unit instead of asking in the chat first. The
	// app does not send it and keeps the chat question.
	IngredientCard bool `json:"ingredient_card,omitempty"`
	// OnDraft is set by a caller that wants the answer as it is written (the
	// SSE route). Server-side only; nil means answer when done.
	OnDraft func(text string) `json:"-"`
}

type AIConversationMessage struct {
	ID      string `json:"id,omitempty"`
	Role    string `json:"role"`
	Content string `json:"content"`
	// Topic is filled only for history rebuilt from stored turns: a short Thai
	// label for what that turn was about, so a turn too old for the verbatim
	// window still appears in the thread index. Never sent to or accepted from the
	// client — the client has no tool metadata to put in it.
	Topic string `json:"-"`
	// At is when a stored turn was said, so the prompt can date each history
	// line; zero for history the client sent. Server-side only, like Topic.
	At time.Time `json:"-"`
}

type AIAskResponse struct {
	Answer         string                   `json:"answer"`
	Intent         AIIntent                 `json:"intent"`
	Task           AITask                   `json:"task,omitempty"`
	Tool           AIToolName               `json:"tool,omitempty"`
	Model          string                   `json:"model"`
	Snapshot       AISnapshot               `json:"snapshot"`
	// ScopeAssumed is true when the answer covers a default time window the user did
	// not ask for ("ยอดขายเท่าไหร่" → last 30 days). The client uses it to offer
	// period-pivot chips, without re-deriving the "no scope stated" test itself.
	ScopeAssumed   bool                     `json:"scope_assumed,omitempty"`
	// Forecast carries the chart-ready sales prediction (history + bounded future +
	// measured error) when the question asked for a forecast.
	Forecast       *AIForecastResult        `json:"forecast,omitempty"`
	// Chart carries a general chart-ready payload (bar / line / pie) when the
	// answer is best shown as a picture — a two-period comparison, a daily trend.
	// Its numbers are computed in Go, the same figures the answer text states; the
	// frontend draws it, the model never lays out the chart itself.
	Chart          *AIChartData             `json:"chart,omitempty"`
	ConversationID string                   `json:"conversation_id,omitempty"`
	TurnID         string                   `json:"turn_id,omitempty"`
	ResolvedPlan   *ResolvedPlan            `json:"resolved_plan,omitempty"`
	ActionPreview  *AIActionPreviewResponse `json:"action_preview,omitempty"`
	// ActionPlan carries a multi-item change waiting for one confirmation.
	ActionPlan     *AIActionPlanResponse     `json:"action_plan,omitempty"`
	CandidateTools []AIToolName             `json:"candidate_tools,omitempty"`
	Planner        *AIPlannerMetadata       `json:"planner,omitempty"`
	ToolsUsed      []AIToolName             `json:"tools_used,omitempty"`
	DocSources     []AISystemDocSource      `json:"doc_sources,omitempty"`
	// FollowUps are the questions the model suggested asking next, written in
	// the owner's words at the end of the same reply. The client shows them as
	// chips under the answer; tapping one sends it verbatim.
	FollowUps      []string                 `json:"follow_ups,omitempty"`
	// Navigate is the page a how-to answer was about, checked against the
	// handbook: the client shows it as a "take me there" button.
	Navigate       *AINavigation            `json:"navigate,omitempty"`
}

// AINavigation is one page of the app, by path and by the name the owner
// reads on the button.
type AINavigation struct {
	Href  string `json:"href"`
	Label string `json:"label"`
}

type AIPlannerMetadata struct {
	Provider         StructuredPlannerProviderName `json:"provider"`
	Model            string                        `json:"model,omitempty"`
	ProviderFallback bool                          `json:"provider_fallback"`
	LocalFallback    bool                          `json:"local_fallback"`
	AttemptCount     int                           `json:"attempt_count"`
}

// AISnapshot and its companion summaries now live in the neutral aitools
// package. These aliases keep every existing reference (service.AISnapshot,
// controller's service.AISnapshot, etc.) compiling unchanged.
type AISnapshot = aitools.AISnapshot
type AIAnalysisReadiness = aitools.AIAnalysisReadiness
type AIInventorySummary = aitools.AIInventorySummary
type AIStockRisk = aitools.AIStockRisk

type AIVerifyPayload struct {
	LowestMarginMenuName string  `json:"lowest_margin_menu_name,omitempty"`
	Quantity             int     `json:"quantity,omitempty"`
	Revenue              float64 `json:"revenue,omitempty"`
	Cost                 float64 `json:"cost,omitempty"`
	Profit               float64 `json:"profit,omitempty"`
	Margin               float64 `json:"margin,omitempty"`
	LowStockCount        int     `json:"low_stock_count,omitempty"`
	OutOfStockCount      int     `json:"out_of_stock_count,omitempty"`
	TopMenuName          string  `json:"top_menu_name,omitempty"`
	TopMenuQuantity      int     `json:"top_menu_quantity,omitempty"`
	TotalItems           int     `json:"total_items,omitempty"`
	TotalValue           float64 `json:"total_value,omitempty"`
}

type AIFinalJSONResponse struct {
	Answer string          `json:"answer"`
	Verify AIVerifyPayload `json:"verify"`
}

type geminiGenerateRequest struct {
	Contents         []geminiContent         `json:"contents"`
	Tools            []geminiTool            `json:"tools,omitempty"`
	GenerationConfig *geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiGenerationConfig struct {
	Temperature *float64 `json:"temperature,omitempty"`
}

type geminiTool struct {
	FunctionDeclarations []geminiFunctionDeclaration `json:"functionDeclarations"`
}

type geminiFunctionDeclaration struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Parameters  geminiParameters `json:"parameters"`
}

type geminiParameters struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties,omitempty"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text         string              `json:"text,omitempty"`
	InlineData   *geminiInlineData   `json:"inline_data,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
}

// geminiInlineData carries a base64-encoded image (or other blob) so Gemini can
// read it — used by the receipt scanner to send a photo for field extraction.
type geminiInlineData struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

type geminiFunctionCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
}

type geminiGenerateResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	// UsageMetadata is what the call cost. cachedContentTokenCount is the part
	// of the prompt Gemini served from its implicit cache — the number that says
	// whether the static prefix (persona, rules, catalogue) is being cached.
	UsageMetadata struct {
		PromptTokenCount        int `json:"promptTokenCount"`
		CachedContentTokenCount int `json:"cachedContentTokenCount"`
		CandidatesTokenCount    int `json:"candidatesTokenCount"`
		ThoughtsTokenCount      int `json:"thoughtsTokenCount"`
		TotalTokenCount         int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

type groqMessage struct {
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	ToolCalls []groqToolCall `json:"tool_calls,omitempty"`
}

type groqToolCall struct {
	Id       string       `json:"id"`
	Type     string       `json:"type"`
	Function groqToolFunc `json:"function"`
}

type groqToolFunc struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type groqRequest struct {
	Model    string        `json:"model"`
	Messages []groqMessage `json:"messages"`
	Tools    []groqTool    `json:"tools,omitempty"`
	// Temperature is a pointer so 0 is actually sent (omitempty would drop a 0
	// value). Used to pin the classifier to deterministic routing.
	Temperature *float64 `json:"temperature,omitempty"`
	// MaxCompletionTokens caps what the model may generate for one reply. Groq
	// deprecated max_tokens in favour of this name, and the planner path already
	// sends this one. It is a pointer for the same reason Temperature is, and
	// every existing caller leaves it nil, so omitempty drops the key and their
	// request bytes are unchanged.
	//
	// Nothing sets it, deliberately. Groq reserves prompt + max_completion_tokens
	// against the daily token budget before the call runs, so asking for headroom
	// costs capacity whether or not it gets used: at 4,096 a single question,
	// which is two calls, reserves about 11,500 of the 200,000 tokens a day. The
	// measured ceiling when it is omitted is 2,048, and the writing has never
	// needed more than 326 of those — what overruns it is the thinking, which
	// ReasoningEffort addresses without spending any budget at all.
	MaxCompletionTokens *int `json:"max_completion_tokens,omitempty"`
	// ReasoningEffort is "low", "medium" or "high" on gpt-oss. Groq defaults it
	// to "medium", which is what every call here ran at before this field
	// existed, without anyone choosing it.
	ReasoningEffort *string `json:"reasoning_effort,omitempty"`
	// Stream asks for the reply as server-sent events; StreamOptions asks for
	// the usage block in the last one. Both omitted on the plain call.
	Stream        bool               `json:"stream,omitempty"`
	StreamOptions *groqStreamOptions `json:"stream_options,omitempty"`
}

type groqStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

// groqStreamChunk is one server-sent event of a streamed Groq reply.
type groqStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *groqUsage `json:"usage"`
}

// zeroTemperature returns a pointer to 0 for deterministic calls (the intent
// classifier), so the same question routes the same way every time.
func zeroTemperature() *float64 {
	v := 0.0
	return &v
}

type groqTool struct {
	Type     string               `json:"type"`
	Function groqFunctionShortcut `json:"function"`
}

type groqFunctionShortcut struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  groqParameters `json:"parameters"`
}

type groqParameters struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties,omitempty"`
}

type groqResponse struct {
	Choices []struct {
		Message groqMessage `json:"message"`
		// FinishReason is "stop" when the model ended on its own and "length"
		// when the provider cut it off. Reading it is the only way to tell the
		// two apart: a cut reply parses fine, is not empty, and reaches the
		// owner with its last word half written — which is exactly what
		// happened to "สรุปสถานการณ์ร้าน" on 23 Aug, ending at "มูลค่ารวมของสิน".
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage groqUsage `json:"usage"`
}

// groqUsage is what the reply cost. It is recorded because the output ceiling
// cannot be set sensibly by guesswork: too low truncates more often than today,
// too high guards nothing. ReasoningTokens separates a model that thought for
// too long from one that wrote for too long, which need opposite fixes — it
// stays zero when the provider does not report it, so zero means "not reported"
// rather than "did not think".
type groqUsage struct {
	PromptTokens            int `json:"prompt_tokens"`
	CompletionTokens        int `json:"completion_tokens"`
	TotalTokens             int `json:"total_tokens"`
	CompletionTokensDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
	// CachedTokens is the slice of prompt_tokens Groq served from its prompt
	// cache. Cached tokens do not count toward the rate limit, so this is the
	// number that says whether the static-prefix layout is actually paying off.
	PromptTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}
