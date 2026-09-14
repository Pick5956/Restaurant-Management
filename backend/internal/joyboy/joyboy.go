package joyboy

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrUnavailable means no answer was produced. The caller reports it to the
// owner as an outage rather than substituting one of its own, because the only
// text Joyboy could substitute is the fact sheet, and the fact sheet is Go's
// writing.
var ErrUnavailable = errors.New("joyboy could not produce an answer")

// Assistant answers questions. Build it with New and keep it; it holds no state
// between questions.
type Assistant struct {
	chat  Chat
	tools Tools
	log   func(format string, args ...any)
	// scope, when set, is asked whether a question the model found no tool for
	// is still the assistant's business. Nil means everything is.
	scope Scope
}

// Option adjusts an assistant at construction.
type Option func(*Assistant)

// WithScope installs the boundary check. See Scope.
func WithScope(scope Scope) Option {
	return func(a *Assistant) { a.scope = scope }
}

// New wires an assistant. log may be nil.
func New(chat Chat, tools Tools, log func(string, ...any), options ...Option) (*Assistant, error) {
	if chat == nil {
		return nil, errors.New("joyboy needs a chat provider")
	}
	if tools == nil {
		return nil, errors.New("joyboy needs a tool runner")
	}
	if log == nil {
		log = func(string, ...any) {}
	}
	assistant := &Assistant{chat: chat, tools: tools, log: log}
	for _, option := range options {
		option(assistant)
	}
	return assistant, nil
}

// Ask runs one question end to end.
func (a *Assistant) Ask(ctx context.Context, request Request) (Answer, error) {
	question := strings.TrimSpace(request.Question)
	if question == "" {
		return Answer{}, errors.New("joyboy needs a question")
	}

	catalogue := a.tools.Catalogue()
	// Argument order matches the template's cache-friendly layout: the static
	// catalogue leads (so Groq caches the whole instruction+rules prefix), and the
	// dynamic history and question come last.
	selection, err := a.chat.Complete(ctx, fmt.Sprintf(
		selectToolsTemplate, renderCatalogue(catalogue),
		formatDigest(request.Digest)+formatHistory(request.History), question), CallSelectTools)
	if err != nil {
		return Answer{}, fmt.Errorf("%w: choosing tools: %w", ErrUnavailable, err)
	}
	requested := parseToolSelection(selection, catalogue)

	// A model that asks for the same tool twice gets it once. Nothing is capped
	// beyond that: how many tools it really reaches for is one of the things
	// this version exists to find out.
	requested = dedupe(requested)
	a.log("joyboy: model asked for %d tool(s): %s", len(requested), strings.Join(requested, ", "))

	// A question the model found a tool for is about the shop by definition.
	// One it found nothing for is the only kind that might be about something
	// else entirely — a poem, a Python loop — and that is the one the boundary
	// is asked about. Asking on every question would cost a call each time to
	// confirm what the tool choice already said.
	if len(requested) == 0 && a.scope != nil {
		verdict, err := a.scope.Check(ctx, question, request.History)
		if err != nil {
			// The boundary being unreachable must not take the answer down with
			// it; the question proceeds as it always has, and the log says so.
			a.log("joyboy: scope check failed (%v) → answering without it", err)
		} else if !verdict.InScope {
			a.log("joyboy: out of scope (%s) → steering back", verdict.Reason)
			return Answer{Text: verdict.Steer}, nil
		}
	}

	results, err := a.tools.Run(ctx, requested, question)
	if err != nil {
		return Answer{}, fmt.Errorf("%w: running tools: %w", ErrUnavailable, err)
	}

	sheet := buildFactSheet(results)
	text, followUps, navigateTo, err := a.write(ctx, question, request.History, todayLine(request.Today)+shopLine(request.RestaurantName)+ownerTitleLine(request.OwnerTitle)+request.Digest, sheet, request.OnDraft)
	if err != nil {
		return Answer{}, err
	}
	// Report the tools that actually produced data, not the ones the model asked
	// for. A requested tool can be dropped on the way (no period parsed, a port
	// that is not wired, a repository error) and the answer is then written from
	// an empty fact sheet — exactly the situation the caller's invention guard
	// exists for. Reporting the request instead told that guard a tool had run,
	// so it stood down and let an unbacked claim through: "ได้จองโต๊ะ P01 ให้แล้ว"
	// over a booking that never happened.
	return Answer{Text: text, Tools: answeredTools(results), FollowUps: followUps, NavigateTo: navigateTo}, nil
}

// answeredTools lists the tools that came back with something to say, in the
// order they ran. A result with an empty body contributed nothing to the fact
// sheet, so it does not count as a tool that answered.
func answeredTools(results []ToolResult) []string {
	names := make([]string, 0, len(results))
	for _, result := range results {
		if strings.TrimSpace(result.Body) == "" {
			continue
		}
		names = append(names, result.Tool)
	}
	return names
}

// write asks for the answer, then checks every large figure in it against the
// fact sheet and asks once more if one of them is not there.
//
// The rule against doing arithmetic is stated in the prompt, and the model keeps
// it almost always — but asked "ขายได้เท่าไหร่ จ่ายไปเท่าไหร่ เหลือเท่าไหร่" it
// subtracted the two and reported a figure that appears in no sheet, as a fact,
// in bold. Logging that (which is all this used to do) tells us afterwards; the
// owner still read the invented number. Naming the figure back to the model gets
// a clean answer, and it fires rarely enough — once in about twenty-five
// questions here — to be worth the extra call when it does.
func (a *Assistant) write(ctx context.Context, question string, history []Turn, digest, sheet string, onDraft func(string)) (string, []string, string, error) {
	text, followUps, navigateTo, unmatched, err := a.writeOnce(ctx, answerPrompt(question, history, digest, sheet), sheet, onDraft)
	if err != nil {
		return text, nil, "", err
	}
	// Reported, not rewritten.
	//
	// A second call used to fire here telling the model those figures did not
	// exist and to write the answer again. Ninety live questions produced two
	// firings and both were wrong: "2569", the Buddhist year inside "เดือน
	// กันยายน 2569", and "2050", a year the owner had typed himself. Nothing
	// invented was ever caught, and each miss cost a whole extra call.
	//
	// It also has to go for the answer to be able to do arithmetic at all. The
	// owner asked "ถ้าลดราคาชาไทยลง 5 บาท กำไรจะเหลือเท่าไหร่" — the result of
	// that subtraction is by definition not in the fact sheet, so the rewrite
	// would have deleted the answer to the question every single time.
	//
	// Working from figures the sheet supplies is not inventing them, and the
	// prompt now asks for the starting figures to be named so the owner can
	// follow the arithmetic. What stays here is the log, which is how we find
	// out whether that trust was misplaced.
	for _, figure := range unmatched {
		a.log("joyboy: answer figure %q is not in the fact sheet — derived, or invented", figure)
	}
	return text, followUps, navigateTo, nil
}

// writeOnce gives the model exactly one second chance. That retry is for a reply
// that arrived empty or as nothing but a wrapper, which a model does
// occasionally and does not repeat; anything worse than that is an outage and is
// reported as one.
func (a *Assistant) writeOnce(ctx context.Context, prompt, sheet string, onDraft func(string)) (string, []string, string, []string, error) {
	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		raw, err := a.completeAnswer(ctx, prompt, onDraft)
		if err != nil {
			lastErr = err
			a.log("joyboy: writing the answer failed on attempt %d: %v", attempt, err)
			continue
		}
		// The follow-up questions come off the end first, so the cleaning and
		// the figure check below see only the answer the owner reads.
		body, followUps, navigateTo := splitFollowUps(raw)
		if text := cleanAnswer(body); text != "" {
			// The fact sheet is the dictionary of correct figures: normalise the
			// separators of any figure that matches it, and report any large one
			// that matches nothing.
			text, unmatched := reconcileFigures(text, sheet)
			return text, followUps, navigateTo, unmatched, nil
		}
		lastErr = errors.New("the model returned nothing usable")
		a.log("joyboy: attempt %d produced nothing usable", attempt)
	}
	return "", nil, "", nil, fmt.Errorf("%w: writing the answer: %w", ErrUnavailable, lastErr)
}

// completeAnswer is the write call, streamed to onDraft when both sides can:
// the chat streams and someone is watching. Each delta is folded into the raw
// reply so far and the owner is shown draftView of it — what they would read
// if the model stopped right there — never the raw text, never the marker.
func (a *Assistant) completeAnswer(ctx context.Context, prompt string, onDraft func(string)) (string, error) {
	streamer, ok := a.chat.(StreamingChat)
	if !ok || onDraft == nil {
		return a.chat.Complete(ctx, prompt, CallWriteAnswer)
	}
	var raw strings.Builder
	last := ""
	return streamer.CompleteStream(ctx, prompt, CallWriteAnswer, func(delta string) {
		raw.WriteString(delta)
		if view := draftView(raw.String()); view != "" && view != last {
			last = view
			onDraft(view)
		}
	})
}

// draftView is the readable part of a reply still being written: everything
// before the follow-up block, minus a marker that has only started to arrive
// ("==", "===ถาม"), cleaned the way the finished answer is.
func draftView(raw string) string {
	view := raw
	if at := strings.Index(view, "==="); at >= 0 {
		view = view[:at]
	}
	view = strings.TrimRight(view, "=")
	return cleanAnswer(view)
}

func dedupe(names []string) []string {
	seen := make(map[string]struct{}, len(names))
	unique := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, repeated := seen[name]; repeated {
			continue
		}
		seen[name] = struct{}{}
		unique = append(unique, name)
	}
	return unique
}
