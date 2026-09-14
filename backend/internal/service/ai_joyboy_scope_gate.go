package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"Project-M/internal/joyboy"
)

// The assistant's boundary, as the owner set it on 12 ก.ย. 2569.
//
// In: this shop's figures, running a restaurant, food and cooking, keeping
// ingredients, promoting the shop (captions, posters, offers), using Dishy,
// and the small talk that keeps the assistant pleasant to talk to.
//
// Out: anything else — the owner's personal life, content that has nothing to
// do with a restaurant (poems, essays, code, homework), news, politics, general
// knowledge. Those get a short turn back toward what the assistant can do.
//
// The professor saw the assistant write a Mother's Day poem and a Python loop.
// It was not misbehaving: the answer prompt told it to answer general questions
// "ตามปกติ ไม่ต้องบ่ายเบี่ยง", and the live path had no gate at all — the one
// at ai_service.go:576 belongs to legacy. This is that gate for joyboy, kept
// to the owner's standing rule that Go never decides meaning by matching words:
// the verdict comes from a model reading the question, and Go only acts on it.

const joyboyScopeTemplate = `คุณคือด่านตรวจของผู้ช่วยร้านอาหาร หน้าที่เดียวคือตัดสินว่าข้อความของผู้ใช้ "อยู่ในขอบเขต" ของผู้ช่วยหรือไม่
ตอบเป็น JSON บรรทัดเดียวเท่านั้น: {"in_scope": true} หรือ {"in_scope": false, "reason": "<ป้ายสั้น ๆ ภาษาอังกฤษ>"}

อยู่ในขอบเขต (in_scope = true):
- ตัวเลขของร้าน ยอดขาย กำไร ต้นทุน สต๊อก เมนู โต๊ะ บิล พนักงานในฐานะข้อมูลร้าน
- การบริหารร้านอาหาร เทคนิคดูแลร้าน ตั้งราคา จัดการวัตถุดิบ บริการลูกค้า
- อาหาร สูตร วิธีทำ วิธีเก็บวัตถุดิบ
- การโปรโมทร้าน แคปชั่น โพสต์ โปรโมชั่น ป้าย ข้อความโฆษณาของร้าน
- วิธีใช้ระบบ Dishy
- ทักทาย ขอบคุณ คุยเล่นสั้น ๆ ที่ยังอยู่ในบรรยากาศของการทำงาน หรือบ่นเรื่องร้าน/งาน

นอกขอบเขต (in_scope = false):
- เรื่องส่วนตัวที่ไม่เกี่ยวกับร้าน (ความรัก ครอบครัว สุขภาพ เรื่องเครียดที่ไม่ใช่เรื่องงาน)
- สร้างเนื้อหาที่ไม่เกี่ยวกับร้านอาหาร (กลอน เรียงความ เพลง นิทาน โค้ดโปรแกรม การบ้าน)
- ข่าว การเมือง กีฬา บันเทิง ความรู้ทั่วไปที่ไม่แตะอาหารหรือร้าน
- คำถามที่ไม่มีทางเกี่ยวกับร้านอาหารไม่ว่าจะมองมุมไหน

หลักตัดสิน: ถ้าคำตอบที่ดีที่สุดของข้อความนี้ต้องพูดถึงร้านอาหาร อาหาร หรือระบบร้าน ให้ถือว่าอยู่ในขอบเขต
ถ้าเนื้อหาเอ่ยชื่อเมนูหรืออาหารแต่แท้จริงขอสิ่งที่ไม่เกี่ยวกับร้าน (เช่น "แต่งกลอนเรื่องผัดไทย") ให้ถือว่านอกขอบเขต
ถ้าไม่แน่ใจ ให้ตอบ true — ตอบผิดว่านอกขอบเขตแล้วปฏิเสธเจ้าของร้าน แย่กว่าตอบผิดว่าอยู่ในขอบเขต

บทสนทนาก่อนหน้า (อาจว่าง):
%s

ข้อความของผู้ใช้:
%s`

// joyboyScope implements joyboy.Scope on top of the service's model rotation.
type joyboyScope struct {
	service *AIService
}

func (s joyboyScope) Check(ctx context.Context, question string, history []joyboy.Turn) (joyboy.ScopeVerdict, error) {
	messages := make([]AIConversationMessage, 0, len(history))
	for _, turn := range history {
		messages = append(messages, AIConversationMessage{Role: turn.Role, Content: turn.Content})
	}
	prompt := fmt.Sprintf(joyboyScopeTemplate, conversationPrompt(routerHistory(messages)), question)
	raw, _, err := s.service.askSecondRoundWithRotation(prompt)
	if err != nil {
		return joyboy.ScopeVerdict{}, err
	}
	inScope, reason, err := parseScopeVerdict(raw)
	if err != nil {
		return joyboy.ScopeVerdict{}, err
	}
	if inScope {
		return joyboy.ScopeVerdict{InScope: true}, nil
	}
	// The steer is the same one-sentence turn-back legacy has always used: it
	// names one or two things the assistant can do and stops.
	steer, _, err := s.service.askOutOfScopeWithRotation(question, messages)
	if err != nil || strings.TrimSpace(steer) == "" {
		steer = "เรื่องนี้อยู่นอกขอบเขตที่ผมช่วยได้ในฐานะผู้ช่วยร้านอาหารครับ แต่ถ้าเป็นยอดขาย กำไร คลังวัตถุดิบ หรือแคปชั่นโปรโมทร้าน ผมช่วยได้เต็มที่ครับ"
	}
	return joyboy.ScopeVerdict{InScope: false, Reason: reason, Steer: strings.TrimSpace(steer)}, nil
}

// parseScopeVerdict reads the one-line JSON the classifier was asked for. It
// tolerates the code fences some models add, and treats anything it cannot
// read as an error rather than a verdict — the caller then answers as normal,
// which is the safe side.
func parseScopeVerdict(raw string) (inScope bool, reason string, err error) {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	// Take the first object in the reply; a model that adds a sentence around
	// the JSON has still answered.
	if open, close := strings.Index(cleaned, "{"), strings.LastIndex(cleaned, "}"); open >= 0 && close > open {
		cleaned = cleaned[open : close+1]
	}
	var verdict struct {
		InScope *bool  `json:"in_scope"`
		Reason  string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(cleaned), &verdict); err != nil {
		return false, "", fmt.Errorf("scope verdict unreadable: %w", err)
	}
	if verdict.InScope == nil {
		return false, "", fmt.Errorf("scope verdict has no in_scope field: %q", cleaned)
	}
	reason = strings.TrimSpace(verdict.Reason)
	if reason == "" {
		reason = "out_of_scope"
	}
	return *verdict.InScope, reason, nil
}
