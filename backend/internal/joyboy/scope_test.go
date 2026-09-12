package joyboy

import (
	"context"
	"errors"
	"testing"
)

type fakeScope struct {
	verdict ScopeVerdict
	err     error
	asked   string
	calls   int
}

func (s *fakeScope) Check(_ context.Context, question string, _ []Turn) (ScopeVerdict, error) {
	s.calls++
	s.asked = question
	return s.verdict, s.err
}

func TestScopeIsAskedOnlyWhenNoToolWasChosen(t *testing.T) {
	// A tool was chosen: the question is about the shop, the boundary is not
	// consulted, and the answer is written from the fact sheet as always.
	scope := &fakeScope{verdict: ScopeVerdict{InScope: false, Steer: "should not appear"}}
	chat := &fakeChat{selected: []string{"get_top_selling_menus"}, replies: []string{"ผัดไทยขายดีที่สุดครับ"}}
	tools := &fakeTools{results: []ToolResult{{Tool: "get_top_selling_menus", Body: "top=ผัดไทย"}}}
	assistant, err := New(chat, tools, nil, WithScope(scope))
	if err != nil {
		t.Fatal(err)
	}
	answer, err := assistant.Ask(context.Background(), Request{Question: "เมนูไหนขายดี"})
	if err != nil {
		t.Fatal(err)
	}
	if scope.calls != 0 {
		t.Fatalf("scope consulted %d time(s) although a tool was chosen", scope.calls)
	}
	if answer.Text != "ผัดไทยขายดีที่สุดครับ" {
		t.Fatalf("answer = %q, want the written one", answer.Text)
	}
}

func TestOutOfScopeQuestionGetsTheSteerAndNoWrite(t *testing.T) {
	scope := &fakeScope{verdict: ScopeVerdict{InScope: false, Reason: "unrelated_content", Steer: "เรื่องนี้อยู่นอกขอบเขตครับ แต่ยอดขายหรือคลังผมช่วยได้"}}
	chat := &fakeChat{selected: []string{}, replies: []string{"a poem the owner must never see"}}
	tools := &fakeTools{}
	assistant, err := New(chat, tools, nil, WithScope(scope))
	if err != nil {
		t.Fatal(err)
	}
	answer, err := assistant.Ask(context.Background(), Request{Question: "แต่งกลอนวันแม่ให้หน่อย"})
	if err != nil {
		t.Fatal(err)
	}
	if scope.asked != "แต่งกลอนวันแม่ให้หน่อย" {
		t.Fatalf("scope saw %q", scope.asked)
	}
	if answer.Text != scope.verdict.Steer {
		t.Fatalf("answer = %q, want the steer", answer.Text)
	}
	if chat.writeCalls != 0 {
		t.Fatalf("the writer ran %d time(s) for an out-of-scope question", chat.writeCalls)
	}
	if len(answer.Tools) != 0 {
		t.Fatalf("tools = %v, want none", answer.Tools)
	}
}

func TestInScopeChatStillAnswersWithoutTools(t *testing.T) {
	// Small talk stays: the owner decided that on 8 ก.ย. and the boundary honours it.
	scope := &fakeScope{verdict: ScopeVerdict{InScope: true}}
	chat := &fakeChat{selected: []string{}, replies: []string{"สวัสดีครับ มีอะไรให้ช่วยดูไหมครับ"}}
	assistant, err := New(chat, &fakeTools{}, nil, WithScope(scope))
	if err != nil {
		t.Fatal(err)
	}
	answer, err := assistant.Ask(context.Background(), Request{Question: "สวัสดี"})
	if err != nil {
		t.Fatal(err)
	}
	if scope.calls != 1 {
		t.Fatalf("scope consulted %d time(s), want exactly once", scope.calls)
	}
	if answer.Text != "สวัสดีครับ มีอะไรให้ช่วยดูไหมครับ" {
		t.Fatalf("answer = %q", answer.Text)
	}
}

func TestScopeFailureNeverBlocksTheAnswer(t *testing.T) {
	scope := &fakeScope{err: errors.New("classifier down")}
	chat := &fakeChat{selected: []string{}, replies: []string{"ตอบตามปกติครับ"}}
	assistant, err := New(chat, &fakeTools{}, nil, WithScope(scope))
	if err != nil {
		t.Fatal(err)
	}
	answer, err := assistant.Ask(context.Background(), Request{Question: "หิวจัง"})
	if err != nil {
		t.Fatal(err)
	}
	if answer.Text != "ตอบตามปกติครับ" {
		t.Fatalf("answer = %q, want the normal reply when the boundary is unreachable", answer.Text)
	}
}

func TestNoScopeMeansEverythingIsInScope(t *testing.T) {
	chat := &fakeChat{selected: []string{}, replies: []string{"ok"}}
	assistant, err := New(chat, &fakeTools{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assistant.Ask(context.Background(), Request{Question: "anything"}); err != nil {
		t.Fatal(err)
	}
}
