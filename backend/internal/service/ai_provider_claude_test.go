package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A Messages stream as Anthropic sends it: the text arrives in pieces, thinking
// (if any) is not text, and the usage is split across the first and last events.
func TestReadClaudeSSEFoldsTheTextAndSkipsThinking(t *testing.T) {
	stream := strings.Join([]string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"usage":{"input_tokens":11080,"cache_read_input_tokens":9000}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"คิดก่อน"}}`,
		`event: ping`,
		`data: {"type":"ping"}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ยอดขายวันนี้ "}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"4,061 บาท"}}`,
		`event: message_delta`,
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}, "\n")
	var pieces []string
	text, stop, usage, firstAt, err := readClaudeSSE(strings.NewReader(stream), func(piece string) { pieces = append(pieces, piece) })
	if err != nil {
		t.Fatal(err)
	}
	if text != "ยอดขายวันนี้ 4,061 บาท" || len(pieces) != 2 || stop != "end_turn" || firstAt.IsZero() {
		t.Fatalf("text=%q pieces=%v stop=%q", text, pieces, stop)
	}
	if usage.InputTokens != 11080 || usage.CacheReadInputTokens != 9000 || usage.OutputTokens != 12 {
		t.Fatalf("usage = %+v", usage)
	}
}

// Anthropic reports an overload that starts after the headers as an error
// event. It has to reach the rotation as an overload, not as a half-answer.
func TestClaudeMidStreamOverloadIsAStall(t *testing.T) {
	stream := "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ยอด\"}}\n" +
		"data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n"
	_, _, _, _, err := readClaudeSSE(strings.NewReader(stream), nil)
	if err == nil || !isProviderOverloaded(err) {
		t.Fatalf("mid-stream overload = %v, want an overload", err)
	}
	if !isProviderOverloaded(newAIProviderHTTPError("claude", "second-round", claudeOverloadedStatus)) {
		t.Fatal("HTTP 529 is Anthropic's overload and must read as one")
	}
}

// End to end against a stand-in server: the request carries what the Messages
// API requires, an overloaded first key is retried on the next, and the answer
// comes back through the same boundary joyboy calls.
func TestClaudeAdapterCompletesThroughTheMessagesAPI(t *testing.T) {
	var requests []claudeRequest
	var keysSeen, versions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body claudeRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		requests = append(requests, body)
		keysSeen = append(keysSeen, r.Header.Get("x-api-key"))
		versions = append(versions, r.Header.Get("anthropic-version"))
		if len(requests) == 1 {
			w.WriteHeader(claudeOverloadedStatus)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"get_sales_summary\"}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n\n")
	}))
	defer server.Close()
	previous := claudeMessagesURL
	claudeMessagesURL = server.URL
	defer func() { claudeMessagesURL = previous }()

	t.Setenv("CLAUDE_API_KEYS", "test-key-one,\n test-key-two")
	t.Setenv("CLAUDE_MODEL", "")
	t.Setenv("AI_PROVIDER", "claude")
	service := &AIService{httpClient: server.Client()}

	text, model, err := service.askSecondRoundWithRotation("เลือกเครื่องมือ")
	if err != nil || text != "get_sales_summary" || model != claudeDefaultModel {
		t.Fatalf("answer = %q / %q, err %v", text, model, err)
	}
	if len(requests) != 2 || keysSeen[0] == keysSeen[1] {
		t.Fatalf("the overloaded first key should be retried on the second: keys %v", len(keysSeen))
	}
	sent := requests[1]
	if sent.Model != claudeDefaultModel || sent.MaxTokens != claudeDefaultMaxTokens || !sent.Stream ||
		len(sent.Messages) != 1 || sent.Messages[0].Role != "user" || sent.Messages[0].Content != "เลือกเครื่องมือ" {
		t.Fatalf("request = %+v", sent)
	}
	if versions[1] != claudeAPIVersion {
		t.Fatalf("anthropic-version = %q", versions[1])
	}
}

// Claude is named like the others, and a chain puts it where it is written.
func TestAIProviderAcceptsClaude(t *testing.T) {
	service := &AIService{}
	t.Setenv("AI_PROVIDER", "gemini,claude")
	if got := service.getAIProvider(); got != "gemini,claude" {
		t.Fatalf("AI_PROVIDER=gemini,claude → %q", got)
	}
	ordered := service.orderedProviderAdapters()
	if len(ordered) != 2 || ordered[0].ID() != "gemini" || ordered[1].ID() != "claude" {
		t.Fatalf("order = %v", ordered)
	}
	t.Setenv("CLAUDE_API_KEYS", "")
	t.Setenv("ANTHROPIC_API_KEY", "single-key")
	if keys := service.getClaudeKeys(); len(keys) != 1 || keys[0] != "single-key" {
		t.Fatalf("ANTHROPIC_API_KEY fallback = %v", keys)
	}
}
