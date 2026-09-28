package service

import (
	"errors"
	"time"
)

// askSecondRoundWithRotation renders a follow-up prompt through the configured
// provider, falling back Groq -> Gemini in "auto" mode.
func (s *AIService) askSecondRoundWithRotation(prompt string) (string, string, error) {
	return s.askSecondRoundWithOptions(prompt, aiProviderCompleteOptions{})
}

// askSecondRoundWithOptions is the same round with a per-call preference
// attached. It is a separate function so the callers that have no preference
// keep the shorter call and stay literally unchanged: the zero options they
// would have had to pass are supplied above instead.
func (s *AIService) askSecondRoundWithOptions(prompt string, opts aiProviderCompleteOptions) (string, string, error) {
	return s.askAcrossProviders(func(adapter aiProviderAdapter) (aiProviderAnswer, error) {
		return adapter.Complete(prompt, opts)
	})
}

// askAcrossProviders runs one completion through the configured providers in
// order, with the park-on-overload and fall-through rules, calling `call` on
// each adapter that is usable. The plain and the streamed call share it.
func (s *AIService) askAcrossProviders(call func(adapter aiProviderAdapter) (aiProviderAnswer, error)) (string, string, error) {
	var lastErr error
	provider := s.getAIProvider()
	adapters := s.orderedProviderAdapters()
	// Setting a provider aside only helps when there is another one to ask
	// instead. With a single provider (AI_PROVIDER=gemini, 28 ก.ย. 2569) it
	// turned every retry within the next 45 seconds into an instant failure that
	// never reached the provider, so the owner's "ลองอีกครั้ง" did nothing.
	fallbacks := 0
	for _, adapter := range adapters {
		if adapter.Configured() {
			fallbacks++
		}
	}
	canPark := fallbacks > 1
	for _, adapter := range adapters {
		if !adapter.Configured() {
			if len(adapters) == 1 && provider != "auto" {
				return "", "", missingProviderConfigurationError(adapter.ID())
			}
			continue
		}
		// A provider that just told us it was overloaded on every key is skipped
		// rather than asked again. One question runs several model calls, and
		// without this each of them rediscovered the same outage key by key —
		// two minutes of waiting to tell the owner nothing.
		if usable, until := s.keyHealth.providerAvailable(adapter.ID()); canPark && !usable {
			aiStage("warn", "second-round %s is set aside for %s (it reported an overload) → skipping",
				adapter.DisplayName(), time.Until(until).Round(time.Second))
			if lastErr == nil {
				lastErr = newAIProviderHTTPError(adapter.ID(), "second-round", 503)
			}
			continue
		}
		answer, err := call(adapter)
		if err == nil {
			s.keyHealth.clear(adapter.ID(), providerWideKeyIndex)
			return answer.Text, answer.Model, nil
		}
		lastErr = err
		if isProviderOverloaded(err) && !canPark {
			aiStage("warn", "second-round %s overloaded and there is no other provider → not set aside, the next question asks again",
				adapter.DisplayName())
			continue
		}
		if isProviderOverloaded(err) {
			s.keyHealth.parkProvider(adapter.ID(), time.Now().Add(aiProviderOverloadPark))
			aiStage("warn", "second-round %s overloaded on every key → set aside for %s",
				adapter.DisplayName(), aiProviderOverloadPark)
			continue
		}
		aiStage("warn", "second-round %s failed → trying next provider: %v", adapter.DisplayName(), err)
	}
	if lastErr != nil {
		return "", "", lastErr
	}
	return "", "", errors.New("no configured AI provider")
}

func (s *AIService) askOutOfScopeWithRotation(question string, history []AIConversationMessage) (string, string, error) {
	prompt := outOfScopePrompt(question, history)
	return s.askSecondRoundWithRotation(prompt)
}
