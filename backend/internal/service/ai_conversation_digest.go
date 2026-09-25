package service

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"Project-M/internal/entity"
)

// Conversation digest — the one piece of memory the model writes rather than Go.
//
// The two layers under it are deterministic: the recent thread is shown verbatim,
// and everything older is indexed by Go from what was actually stored (the
// owner's question, and the section of the shop its tool belonged to). Between
// them they answer "what did we talk about". What they cannot answer is what was
// DECIDED — "ไม่ต้องสั่งกะเพราเพิ่ม พรุ่งนี้ร้านปิด" is a conclusion spread across
// two turns, and no amount of indexing recovers it.
//
// So this asks the model. Deliberately without a Go gate on what it writes.
//
// The first design had one: the model would only be allowed to quote sentences
// verbatim, and Go would verify each quote appeared in the stored question. That
// makes invention impossible — and also makes the feature nearly useless, because
// a decision is rarely one quotable sentence, and Thai has no word boundaries to
// check anything looser against. The owner's call was to give the model room
// first and judge it on results. That is the right order: a limit added before
// there is evidence it is needed is a limit nobody can argue with later.
//
// What stays is hygiene, which is not the same thing as a content gate: a cap on
// length, no control characters, no markdown that would confuse the prompt, and
// no tool names — that last one because a raw get_* name has reached an owner's
// screen twice before. None of these decide whether the model summarised well.
//
// Every digest is logged in full. Judging it is a person's job for now, and the
// log is what that judgement will be made from.

// aiConversationDigestEnabled gates the whole feature. Off unless asked for, so a
// conversation that never turns it on costs exactly what it costs today.
func aiConversationDigestEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AI_CONVERSATION_DIGEST_ENABLED"))) {
	case "1", "true", "on", "enabled":
		return true
	default:
		return false
	}
}

const (
	// How many turns must pile up beyond what the digest already covers before it
	// is worth spending a call. Six keeps short conversations — most of them —
	// completely free.
	aiDigestTurnThreshold = 6
	// The newest turns are shown verbatim in the prompt already; summarising them
	// would just repeat them.
	aiDigestSkipRecentTurns = 3
	// A digest longer than this stops being a memory and becomes a second
	// conversation inside the prompt.
	aiDigestMaxRunes = 900
)

// aiDigestPromptTemplate asks for prose, not a schema. A schema would be the
// place to smuggle the old validator back in — "one quote per item, verified" —
// and the point of this version is to find out what the model does when it is
// simply told what matters and trusted to write it.
const aiDigestPromptTemplate = `คุณกำลังช่วยผู้ช่วย AI ของร้านอาหารจำสิ่งที่เจ้าของร้านคุยไว้

ด้านล่างคือบทสนทนาที่ผ่านมา ให้เขียน "บันทึกช่วยจำ" สั้น ๆ ว่ามีอะไรที่ควรจำไว้ใช้ในการคุยครั้งต่อไป

สิ่งที่ควรจำ:
- **สิ่งที่เจ้าของร้านตัดสินใจไปแล้ว** เช่น ตกลงจะสั่งของ ไม่สั่งของ จะปรับราคา จะปิดร้าน
  พร้อมเหตุผลถ้าเขาบอกไว้
- **สิ่งที่เจ้าของร้านสนใจหรือไม่สนใจ** เช่น สนใจกำไรมากกว่ายอดขาย ไม่อยากขึ้นราคา
- **เรื่องที่ค้างไว้** เช่น บอกว่าเดี๋ยวค่อยดู หรือให้ไปเช็คให้ทีหลัง
- **สถานการณ์ของเจ้าของร้าน** ถ้าเขาเล่าไว้ เช่น พรุ่งนี้ปิดร้าน กำลังจะไปต่างจังหวัด

สิ่งที่ห้ามใส่:
- **ห้ามใส่ตัวเลขทุกชนิด** ไม่ว่าจะยอดขาย กำไร จำนวนสต๊อก หรือเปอร์เซ็นต์
  เพราะตัวเลขของร้านเปลี่ยนตลอดเวลา ถ้าจะตอบตัวเลขต้องไปดึงข้อมูลสดใหม่เสมอ
  ให้เขียนว่า "คุยเรื่องกำไรของต้มยำกุ้ง" ไม่ใช่ "กำไรต้มยำกุ้ง 30,032 บาท"
- ห้ามใส่ชื่อฟังก์ชันหรือชื่อเครื่องมือของระบบ
- ห้ามสรุปสิ่งที่ไม่มีใครพูด ถ้าไม่มีอะไรน่าจำก็ตอบว่า "ไม่มี"
- **ห้ามจดสถานะปัจจุบันของร้านที่เดี๋ยวก็เปลี่ยน** เช่น "ตอนนี้ไม่มีโต๊ะว่าง"
  "เมนูที่กำไรดีที่สุดคือ..." "ของเหลือเยอะแล้ว" เพราะพอถึงรอบหน้ามันอาจไม่จริงแล้ว
  ให้จดเฉพาะสิ่งที่ "เจ้าของร้านพูดหรือตัดสินใจ" ซึ่งไม่เปลี่ยนตามเวลา
- ห้ามเขียนบรรทัดที่ไม่มีเนื้อหา เช่น "ไม่มีข้อมูลอื่นที่ต้องจำ" ถ้าไม่มีก็ไม่ต้องเขียนบรรทัดนั้น

รูปแบบ: เขียนเป็นบรรทัดสั้น ๆ ขึ้นต้นด้วย "- " บรรทัดละเรื่อง **เขียนเท่าที่มีจริง**
ถ้ามีเรื่องเดียวก็เขียนบรรทัดเดียว ไม่ต้องหาอะไรมาเติมให้ครบ สูงสุด 6 บรรทัด
ภาษาไทย เขียนให้คนอ่านรู้เรื่อง ไม่ต้องเป็นทางการ

**หนึ่งเรื่องเขียนครั้งเดียว** ถ้าสองบรรทัดพูดเรื่องเดียวกันคนละสำนวน ให้รวมเป็นบรรทัดเดียว
**ห้ามเขียนกติกาหรือคำสั่งข้างบนนี้ลงไปในบันทึก** บันทึกมีไว้เก็บสิ่งที่เจ้าของร้านพูด ไม่ใช่วิธีเขียนบันทึก

ตัวอย่างที่ดี:
- เจ้าของบอกว่ายังไม่สั่งของเพิ่ม เพราะวันจันทร์ร้านปิด
- เจ้าของไม่อยากขึ้นราคา กลัวลูกค้าประจำหาย

ตัวอย่างที่ไม่ดี (ห้ามเขียนแบบนี้):
- เจ้าของไม่อยากขึ้นราคา          <- ซ้ำกับบรรทัดล่าง
- เจ้าของกลัวลูกค้าหายถ้าขึ้นราคา   <- เรื่องเดียวกัน ควรรวมเป็นบรรทัดเดียว
- ไม่มีเรื่องอื่นที่ต้องจำเพิ่มเติม     <- บรรทัดเปล่า ไม่ต้องเขียน
- (ถ้าไม่มีข้อมูลให้ตอบว่าไม่มี)      <- นี่คือกติกา ไม่ใช่สิ่งที่เจ้าของพูด

%s

บันทึกช่วยจำ:`

// aiDigestToolLabel matches a bare tool name. cleanAnswer only strips the
// bracketed form, and this text is written into a later prompt rather than shown
// to anyone, so an unbracketed name would survive to be copied out.
var aiDigestToolLabel = regexp.MustCompile(`\b(get|search)_[a-z0-9_]+\b`)

// buildDigestPrompt renders the turns the digest does not cover yet.
//
// Both sides of each exchange go in. The earlier design showed the model only the
// owner's questions, to keep answer text from cycling back into a prompt — but a
// decision usually lives in the reply to something the assistant said, and half a
// conversation is not enough to see one.
func buildDigestPrompt(turns []entity.AIConversationTurn, previous string) string {
	lines := make([]string, 0, len(turns)*2+4)
	if strings.TrimSpace(previous) != "" {
		lines = append(lines, "บันทึกช่วยจำเดิม (ให้รวมเข้ากับของใหม่ ตัดที่ไม่สำคัญแล้วออกได้):", previous, "")
	}
	lines = append(lines, "บทสนทนา:")
	for _, turn := range turns {
		lines = append(lines,
			"เจ้าของร้าน: "+strings.TrimSpace(turn.Question),
			"ผู้ช่วย: "+strings.TrimSpace(turn.Answer))
	}
	return fmt.Sprintf(aiDigestPromptTemplate, strings.Join(lines, "\n"))
}

// tidyDigest is hygiene only: it decides nothing about whether the summary is
// right, which is the model's job now and a reviewer's job afterwards.
func tidyDigest(raw string) string {
	text := strings.TrimSpace(raw)
	text = strings.Trim(text, "`")
	text = strings.TrimSpace(strings.TrimPrefix(text, "json"))
	if text == "" {
		return ""
	}
	// "ไม่มี" is a real answer — nothing in this stretch was worth remembering.
	if trimmed := strings.TrimSpace(strings.Trim(text, "-• ")); trimmed == "ไม่มี" {
		return ""
	}
	text = aiDigestToolLabel.ReplaceAllString(text, "")
	kept := make([]string, 0, 8)
	seen := make(map[string]bool, 8)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Markdown headings and emphasis would be read as instructions when this
		// text is pasted into the next prompt.
		line = strings.Trim(line, "#>*_` ")
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "- ") {
			line = "- " + line
		}
		// A line that is nothing but a parenthetical is the model repeating the
		// instructions back — "(หากไม่มีข้อมูลเพิ่มเติม ให้ตอบว่าไม่มี)" was stored
		// as a memory. Left in, the prompt's own rules accumulate inside the memory
		// they were written for. Detected by shape, not by matching any words.
		body := strings.TrimSpace(strings.TrimPrefix(line, "- "))
		if strings.HasPrefix(body, "(") && strings.HasSuffix(body, ")") {
			continue
		}
		// The same fact arrived twice in one digest ("ชอบให้เห็นกำไรก่อนยอดขาย" and
		// "สนใจกำไรมากกว่าตัวเลขยอดขาย"). Exact repeats are cheap to drop here;
		// near-repeats are the prompt's job, since deciding two Thai sentences mean
		// the same thing is exactly the judgement Go should not be making.
		if seen[body] {
			continue
		}
		seen[body] = true
		kept = append(kept, line)
		if len(kept) >= 6 {
			break
		}
	}
	if len(kept) == 0 {
		return ""
	}
	digest := strings.Join(kept, "\n")
	if runes := []rune(digest); len(runes) > aiDigestMaxRunes {
		digest = string(runes[:aiDigestMaxRunes])
	}
	return digest
}

// summarizeConversation asks the model for a digest of the turns not yet covered.
// It returns "" whenever there is nothing worth writing, which the caller treats
// as "keep what you had".
// The second value says whether the model was reached: false means keep the
// old digest and try again next turn; true with an empty digest means the turns
// held nothing worth keeping.
func (s *AIService) summarizeConversation(turns []entity.AIConversationTurn, previous string) (string, bool) {
	if len(turns) == 0 {
		return "", true
	}
	prompt := buildDigestPrompt(turns, previous)
	// Low effort on purpose: this is a reading-and-condensing job, not a
	// reasoning one, and it runs on top of every sixth question.
	text, _, err := s.askSecondRoundWithOptions(prompt, aiProviderCompleteOptions{ReasoningEffort: "low"})
	if err != nil {
		aiStage("warn", "digest: การสรุปบทสนทนาไม่สำเร็จ (%v) — ใช้บันทึกเดิมต่อ", err)
		return "", false
	}
	digest := tidyDigest(text)
	// Logged in full and on purpose. With no Go gate deciding whether the model
	// summarised honestly, the log is the only place that judgement can be made
	// from — and the first thing to read when an answer cites something odd.
	aiStage("debug", "digest: จากบทสนทนา %d เทิร์น ได้บันทึก:\n%s", len(turns), digest)
	return digest, true
}
