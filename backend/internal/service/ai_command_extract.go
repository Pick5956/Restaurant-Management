package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"Project-M/internal/repository"
)

// Reading a sentence into proposed changes.
//
// This is the one place a model is allowed to shape a command, and its output is
// treated as a proposal, never as truth: names are looked up, units converted,
// numbers bounds-checked, and the owner confirms — all downstream of here. The
// model is asked for JSON only, and anything that is not a well-formed array of
// known fields is discarded rather than guessed at.

// AICommandExtractor proposes structured changes from the owner's words. It is
// an interface so the pipeline can be tested without a provider.
type AICommandExtractor interface {
	ExtractStockCommands(question string, history []AIConversationMessage) ([]AIStockCommandDraft, error)
}

// aiStockExtractionPrompt asks for a strict JSON array. It states the three
// kinds explicitly because "ปรับเป็น" (set) and "เพิ่ม" (add) are different
// writes that sound alike, and tells the model to leave a field empty rather
// than invent it — an empty field becomes a question to the owner, which is
// always better than a confident wrong number.
const aiStockExtractionPrompt = `คุณคือตัวแปลงคำสั่งของผู้ช่วยร้านอาหาร แปลงข้อความของเจ้าของร้านเป็น JSON array เท่านั้น

กฎ:
- ตอบเป็น JSON array อย่างเดียว ห้ามมีข้อความอื่น ห้ามมี markdown
- แต่ละสมาชิกคือ {"name": "ชื่อสิ่งของ", "kind": "ชนิดคำสั่ง", "quantity": ตัวเลข, "unit": "หน่วยที่ผู้ใช้พูด"}

คำสั่งเกี่ยวกับ "วัตถุดิบในคลัง" (name = ชื่อวัตถุดิบ)
- "in" = รับเข้า/เพิ่ม/ซื้อมา · "out" = ตัดออก/ใช้ไป/ทิ้ง · "adjust" = ตั้งยอดใหม่/ปรับเป็น/นับได้
- "min" = ตั้งขั้นต่ำ/แจ้งเตือนเมื่อเหลือ · "cost" = ตั้งราคาต่อหน่วย/ราคาขึ้น (quantity = บาทต่อหน่วย)
- "create" = เพิ่มวัตถุดิบใหม่เข้าคลัง (ต้องมี unit ถ้าผู้ใช้บอก)

คำสั่งเกี่ยวกับ "เมนูที่ขายหน้าร้าน" (name = ชื่อเมนู · quantity เป็น 0 · unit เป็น "")
- "menu_off" = ปิดขาย/หยุดขาย/งดขาย/เอาลง/ของหมดขายไม่ได้แล้ว
- "menu_on"  = เปิดขาย/กลับมาขาย/เอาขึ้นใหม่
- "menu_price" = เปลี่ยนราคาขายของเมนู (quantity = ราคาป้ายใหม่ เป็นบาทต่อจาน)
  ระวังอย่าสับสนกับ "cost" ซึ่งเป็นราคาทุนของวัตถุดิบ ไม่ใช่ราคาขายของเมนู
- "menu_create" = เพิ่มเมนูใหม่เข้าร้าน/สร้างเมนู (name = ชื่อเมนูใหม่ · quantity = ราคาขาย ถ้าบอก
  · "category" = ชื่อหมวดเมนูตามที่เขาพูด เช่น "ข้าว" "เครื่องดื่ม" ถ้าไม่บอกให้เว้น "" ระบบจะถามเอง)
  ต่างจาก "create" ที่เป็นการเพิ่มวัตถุดิบเข้าคลัง — "เพิ่มเมนู" คือของที่ขายหน้าร้าน

คำสั่งเกี่ยวกับ "บันทึกรายจ่ายของร้าน" (เงินที่จ่ายออกไปจริง)
- "expense" = จ่ายค่าอะไรไป/ซื้ออะไรมา/เสียเงินค่าอะไร
- ใส่เพิ่ม 2 ช่อง: "category" และ "date"
- quantity = จำนวนเงินบาท · note = จ่ายค่าอะไร (เขียนสั้น ๆ เป็นคำพูด)
- category เลือกจาก 6 ค่านี้เท่านั้น ห้ามคิดค่าใหม่
  · "ingredient" = วัตถุดิบ ของสด ของแห้ง เครื่องปรุง
  · "labor" = ค่าแรง เงินเดือน ค่าจ้าง โอที
  · "rent" = ค่าเช่าที่ ค่าเช่าร้าน
  · "utilities" = ค่าน้ำ ค่าไฟ ค่าแก๊ส ค่าเน็ต ค่าโทรศัพท์
  · "equipment" = อุปกรณ์ เครื่องครัว โต๊ะเก้าอี้ ของใช้ที่ใช้ได้นาน
  · "other" = อย่างอื่นที่ไม่เข้าห้าข้อบน
- date เป็น "YYYY-MM-DD" ถ้าผู้ใช้ไม่ได้บอกวันเลย ให้เว้นว่าง ระบบจะใช้วันนี้เอง
  แต่ถ้าผู้ใช้บอกวันแบบพูด ๆ ("เมื่อวาน" "เมื่อวานซืน" "วันที่ 20") ให้คำนวณเป็นวันที่จริง
  โดยนับจากวันที่ปัจจุบันที่แจ้งไว้ข้างล่าง
- ถ้าเดาหมวดไม่ออกจริง ๆ ให้ category เป็น "" ระบบจะถามเอง ห้ามเดามั่ว
- **ถ้าเขาสั่งบันทึกรายจ่ายแต่ไม่บอกจำนวนเงิน ก็ยังเป็นคำสั่ง** ส่งมาด้วย quantity 0
  ห้ามตอบ [] เพราะไม่มีตัวเลข ระบบจะถามจำนวนเงินเอง เช่น "บันทึกค่าไฟ" → name="ค่าไฟ" quantity=0
สกุลเงิน (ใช้กับ expense · cost · menu_price):
- quantity คือตัวเลขตามที่เขาพูด **ห้ามแปลงสกุลเงินเอง**
- ถ้าเขาพูดเป็นเงินสกุลอื่นที่ไม่ใช่บาท (ดอลลาร์ ดอล USD เยน ยูโร ปอนด์ หยวน ริงกิต ฯลฯ)
  ให้ใส่ช่อง "currency" เป็นรหัสสกุลเงิน เช่น "USD" "JPY" "EUR" ระบบจะถามเจ้าของว่าเป็นกี่บาท
- เป็นบาท หรือไม่ได้บอกสกุลเงิน → ไม่ต้องใส่ currency

กฎร่วม:
- ถ้าผู้ใช้ไม่ได้บอกจำนวน ให้ quantity เป็น 0 · ถ้าไม่ได้บอกหน่วย ให้ unit เป็น ""
- **ถ้าตัวเลขที่เขาบอกดูผิดปกติ ก็ยังต้องส่งมาตามที่เขาพูด** เช่นราคาติดลบ จำนวนติดลบ
  **ห้ามทิ้งทั้งคำสั่งเพราะเห็นว่าตัวเลขแปลก** ระบบมีด่านตรวจตัวเลขอยู่แล้ว
  และมันจะอธิบายให้เจ้าของร้านฟังได้ตรงจุดว่าติดตรงไหน
  ถ้าคุณทิ้งไปเงียบ ๆ เจ้าของจะได้คำตอบกว้าง ๆ ว่าทำให้ไม่ได้ โดยไม่รู้ว่าเพราะอะไร
- **ห้ามเดาชื่อที่ผู้ใช้ไม่ได้พูด** ทุกชื่อที่ตอบกลับมาต้องมาจากข้อความของผู้ใช้
  หรือจากบทสนทนาก่อนหน้าเท่านั้น ระบบจะทิ้งชื่อที่ไม่ได้มาจากสองที่นี้
- **ยกชื่อมาให้ครบตามที่ผู้ใช้พูด ห้ามตัดให้สั้นลง**
- **name ต้องเป็นชื่อล้วน ห้ามติดหน่วย ปริมาณ หรือคำสั่ง**
  เช่น "ของXซองละ 6" → name="ของX" unit="ซอง" · "ของYกิโลละ 180" → name="ของY" unit="กก."
  **ห้ามเอาคำกริยามาไว้ในชื่อ** เช่น "บันทึกค่าไฟ 3200" → name="ค่าไฟ" ไม่ใช่ "บันทึกค่าไฟ"
  "ซื้อของA มา 2 กก." → name="ของA" ไม่ใช่ "ซื้อของA"
  คำว่า บันทึก ซื้อ เพิ่ม ตัด ปรับ ตั้ง สั่ง เป็นคำสั่ง ไม่ใช่ส่วนหนึ่งของชื่อ
- ปนกันได้ ข้อความเดียวมีทั้งคำสั่งเมนูและคำสั่งคลังพร้อมกันก็ได้
- **สานต่อจากบทสนทนาก่อนหน้าได้** ถ้าผู้ช่วยเพิ่งถามหรือเพิ่งเสนอทำอะไรกับวัตถุดิบ/เมนูตัวหนึ่ง
  แล้วข้อความล่าสุดของผู้ใช้เป็นการตอบรับ (เช่น "เพิ่มเลย" "เอาเลย" "ตกลง") หรือบอกแค่จำนวน/หน่วย
  ให้ยกชื่อและชนิดคำสั่งจากที่ผู้ช่วยเสนอมาเติมให้ครบ — **ไม่ถือว่าเป็นการเดา** เพราะมาจากบทสนทนาจริง
- **ถ้าเป็นคำถาม ไม่ใช่คำสั่ง ให้ตอบ []** เช่น "เมนูไหนควรปิดขาย" "เดือนนี้จ่ายอะไรไปบ้าง"
  "สรุปสิ่งที่สั่งไว้ทั้งหมด" — การขอให้สรุปหรือขอให้เล่า ไม่ใช่คำสั่งให้แก้ข้อมูล
- **ประโยคสมมติที่ถามว่า "ถ้าเปลี่ยนแล้วผลจะเป็นยังไง" ก็เป็นคำถาม ให้ตอบ []**
  เช่น "ถ้าลดราคาเมนูX ลง 5 บาท กำไรจะเหลือเท่าไหร่" "ตั้งราคาเมนูY 139 ดีมั้ย" "ลดเมนูX เหลือ 44 คุ้มมั้ย"
  "ของA ขึ้นเป็นกิโลละ 400 เมนูX จะเหลือกำไรเท่าไหร่" "สมมติขายเมนูY ได้อีก 50 จาน กำไรเป็นเท่าไหร่"
  "ของB ขึ้นฟองละ 2 บาท เมนูไหนโดนหนักสุด" (บอกว่าของขึ้นราคา แล้วถามว่ากระทบเมนูไหน ไม่ได้สั่งตั้งราคาทุน
  และ "ขึ้น 2 บาท" ก็ไม่ใช่ "ราคา 2 บาท" ถ้าแปลงเป็นคำสั่ง cost จะได้ตัวเลขผิดด้วย)
  ประโยคพวกนี้มีตัวเลขและมีคำว่า ลด ขึ้น ตั้ง อยู่ก็จริง แต่ลงท้ายด้วยการถามผล (เท่าไหร่ ดีมั้ย คุ้มมั้ย ยังไง)
  เขายังไม่ได้ตัดสินใจ ถ้าแปลงเป็นคำสั่ง เขาจะได้กล่องให้กดเปลี่ยนราคา ทั้งที่แค่ถามว่าควรเปลี่ยนไหม
  ต่างจาก "ปรับราคาเมนูY เป็น 139" หรือ "ของA ขึ้นราคาเป็นกิโลละ 180" ที่บอกให้ทำเลย ไม่ได้ถามผล
- **ถ้าข้อความมีแต่ชื่อของอย่างเดียว ไม่มีคำสั่งและไม่มีตัวเลข ให้ตอบ []**
  นั่นคือเขาอยากรู้ข้อมูลของสิ่งนั้น ไม่ใช่สั่งให้แก้
  **ยกเว้น** ข้อความก่อนหน้าของผู้ช่วยเพิ่งถามชื่อของที่จะเพิ่ม (เช่น "จะเพิ่มวัตถุดิบชื่ออะไรครับ")
  แล้วผู้ใช้ตอบมาแค่ชื่อ — นั่นคือการตอบคำถาม ให้ส่งเป็น "create" พร้อมชื่อนั้น
- **สั่งเพิ่มวัตถุดิบแต่ยังไม่บอกชื่อ ก็ยังเป็นคำสั่ง** เช่น "เพิ่มวัตถุดิบ" "เพิ่มวัตถุดิบอื่น" "เพิ่มของเข้าคลังหน่อย"
  ให้ส่ง name="" kind="create" ห้ามตอบ [] ระบบจะถามชื่อเอง
- **ประโยคที่บอกให้ "ยังอย่าเพิ่งทำ" หรือ "อย่าทำ" ไม่ใช่คำสั่ง ให้ตอบ []**
  เช่น "อย่าเพิ่งปิดขาย..." "ยังไม่ต้องเพิ่ม..." "ไม่ต้องปิด..." "อย่าเพิ่งสั่งของ..."
  ระวังเป็นพิเศษ อย่าเห็นคำว่า "ปิดขาย" หรือ "เพิ่ม" ในประโยคแล้วรีบแปลงเป็นคำสั่ง
- ถ้าข้อความไม่ใช่คำสั่งเลย ให้ตอบ []
- **ถ้าประโยคสั่งหลายอย่าง แล้วมีอันที่รู้ว่าเป็นคำสั่งแต่ไม่รู้ว่าหมายถึงของชิ้นไหน
  ห้ามทิ้งอันนั้น** ให้ส่งมาด้วยโดยให้ name เป็น "" และใส่คำพูดเดิมของผู้ใช้ไว้ใน note
  ระบบจะถามกลับเอง · ถ้าทิ้งไป เจ้าของจะสั่งสองอย่างแต่ได้ยินเรื่องเดียวโดยไม่รู้ตัว
- **ถ้าผู้ช่วยเพิ่งบอกว่า "... — รับทราบแล้วครับ" แล้วถามต่อว่าอีกอันหมายถึงตัวไหน
  ให้ส่งกลับมาทั้งสองอัน** ทั้งอันที่รับทราบไปแล้ว (ยกจำนวนและหน่วยเดิมมาให้ครบ)
  และอันที่ผู้ใช้เพิ่งบอกชื่อ ห้ามส่งมาแค่อันใหม่ ไม่งั้นอันแรกจะหายไปเงียบ ๆ

ตัวอย่าง — **ชื่อในตัวอย่างเป็นชื่อสมมติ ไม่มีอยู่จริงในร้านไหน
ห้ามลอกชื่อพวกนี้ไปใส่คำตอบเด็ดขาด ดูแค่รูปแบบพอ**

ข้อความ: "รับของA เข้า 2 กก. ของB 5 กก."
ตอบ: [{"name":"ของA","kind":"in","quantity":2,"unit":"กก."},{"name":"ของB","kind":"in","quantity":5,"unit":"กก."}]

ข้อความ: "เมนูX หมดแล้ว เอาลงก่อนนะ แล้วก็รับของA เข้า 2 กก."
ตอบ: [{"name":"เมนูX","kind":"menu_off","quantity":0,"unit":""},{"name":"ของA","kind":"in","quantity":2,"unit":"กก."}]

ข้อความ: "เปิดขายเมนูY ด้วย ขายจานละ 89 นะ"
ตอบ: [{"name":"เมนูY","kind":"menu_on","quantity":0,"unit":""},{"name":"เมนูY","kind":"menu_price","quantity":89,"unit":""}]

ข้อความ: "ปรับของA เป็น 500 กรัม ตัดของB ออก ตั้งขั้นต่ำของA 1 กก."
ตอบ: [{"name":"ของA","kind":"adjust","quantity":500,"unit":"กรัม"},{"name":"ของB","kind":"out","quantity":0,"unit":""},{"name":"ของA","kind":"min","quantity":1,"unit":"กก."}]

ข้อความ: "ของA ขึ้นราคาเป็นกิโลละ 180"
ตอบ: [{"name":"ของA","kind":"cost","quantity":180,"unit":"กก."}]

ข้อความ: "เพิ่มของC เข้าคลังหน่อย หน่วยกรัม"
ตอบ: [{"name":"ของC","kind":"create","quantity":0,"unit":"กรัม"}]

ข้อความ: "เพิ่มวัตถุดิบ"
ตอบ: [{"name":"","kind":"create","quantity":0,"unit":""}]

ผู้ช่วยเพิ่งถาม: "จะเพิ่มวัตถุดิบชื่ออะไรครับ บอกชื่อกับจำนวนมาได้เลย"
ข้อความ: "ของD"
ตอบ: [{"name":"ของD","kind":"create","quantity":0,"unit":""}]

ข้อความ: "เมื่อวานจ่ายค่าแรงพนักงาน 2 คน 1,200 บาท แล้วก็ซื้อกระทะใหม่ 1500"
ตอบ: [{"name":"ค่าแรงพนักงาน","kind":"expense","quantity":1200,"unit":"","category":"labor","date":"","note":"ค่าแรงพนักงาน 2 คน"},{"name":"กระทะ","kind":"expense","quantity":1500,"unit":"","category":"equipment","date":"","note":"ซื้อกระทะใหม่"}]

ข้อความ: "เพิ่มเมนูใหม่ เมนูZ ราคา 120 บาท อยู่หมวดข้าว"
ตอบ: [{"name":"เมนูZ","kind":"menu_create","quantity":120,"unit":"","category":"ข้าว"}]

ข้อความ: "สร้างเมนู เมนูW ให้หน่อย"
ตอบ: [{"name":"เมนูW","kind":"menu_create","quantity":0,"unit":"","category":""}]

ข้อความ: "บันทึกค่าไฟ"
ตอบ: [{"name":"ค่าไฟ","kind":"expense","quantity":0,"unit":"","category":"utilities","date":"","note":"ค่าไฟ"}]

ข้อความ: "บันทึกค่าไฟ 5000 ดอล"
ตอบ: [{"name":"ค่าไฟ","kind":"expense","quantity":5000,"unit":"","category":"utilities","date":"","note":"ค่าไฟ","currency":"USD"}]

ข้อความ: "รับของA เข้า 5 กก. แล้วก็เติมของอีกตัวที่หมดไปเมื่อวานด้วย"
ตอบ: [{"name":"ของA","kind":"in","quantity":5,"unit":"กก."},{"name":"","kind":"in","quantity":0,"unit":"","note":"ของอีกตัวที่หมดไปเมื่อวาน"}]

(บทสนทนาก่อนหน้า)
ผู้ช่วย: ยังไม่มี "ของC" ในคลังครับ ให้ผมเพิ่มเข้าคลังให้ไหม (บอกหน่วยด้วย)
ข้อความล่าสุด: เพิ่มเลย 5000 กรัม
ตอบ: [{"name":"ของC","kind":"create","quantity":5000,"unit":"กรัม"}]

ข้อความที่ตอบ [] : "ยอดขายวันนี้เท่าไหร่" · "เมนูไหนควรปิดขายดี" · "เดือนนี้จ่ายอะไรไปบ้าง"
· "สรุปสิ่งที่ผมสั่งไว้ทั้งหมด" · "ของA" (ชื่อเปล่า ๆ) · "อย่าเพิ่งปิดขายเมนูX นะ"
· "ยังไม่ต้องเพิ่มของB ตอนนี้ รอดูของก่อน" · "ถ้าลดราคาเมนูX ลง 5 บาท กำไรเหลือเท่าไหร่"
· "ตั้งราคาเมนูY 139 ดีมั้ย" (ถามว่าควรไหม ไม่ได้สั่ง)

ข้อความของเจ้าของร้าน:
`

// ExtractStockCommands asks the model to shape the sentence, including the last
// few turns so an answer to a question ("กรัม") joins the command that prompted
// it without a separate state machine.
func (s *AIService) ExtractStockCommands(question string, history []AIConversationMessage) ([]AIStockCommandDraft, error) {
	if strings.TrimSpace(question) == "" {
		return nil, nil
	}
	// The date goes in because "เมื่อวานจ่ายค่าแรง 1,200" has to become a real
	// date, and the model cannot count back from a day it was never told.
	today := fmt.Sprintf("(วันนี้คือ %s)\n", repository.BangkokNow().Format("2006-01-02"))
	prompt := aiStockExtractionPrompt + today + aiRecentTurnsForExtraction(history) + strings.TrimSpace(question)
	text, _, err := s.askSecondRoundWithOptions(prompt, aiProviderCompleteOptions{ReasoningEffort: "low", Model: aiSupportModel()})
	if err != nil {
		return nil, err
	}
	drafts, err := ParseStockCommandDrafts(text)
	// What the model made of the sentence is the first thing worth seeing when a
	// command comes out wrong, and it was the one step of this flow that left no
	// trace: the plan is logged, the answer is logged, the reading between them
	// was not.
	if aiDebugEnabled() {
		aiStage("debug", "joyboy command: read %d draft(s) from %q → %s", len(drafts), question, strings.TrimSpace(text))
	}
	return keepDraftsTheOwnerNamed(drafts, question, history), err
}

// keepDraftsTheOwnerNamed drops any draft naming something nobody said.
//
// "สรุปสิ่งที่ผมสั่งไว้ทั้งหมดให้หน่อย" — a request for a summary, containing no
// command at all — came back as twenty-one drafts. They were the prompt's own
// worked examples, in the order they appear in it, with the example quantities
// intact: ค่าไฟ 3200, ค่าแรงพนักงาน 1200, ผักชี, ซุปเห็ดครีม. The words "สั่ง"
// and "ทั้งหมด" read to the model as "list every command", and the only list it
// could see was the one teaching it the format.
//
// The prompt forbids this in as many words. It was ignored, so the rule is
// enforced here instead, on the model's output rather than on the owner's
// question: every name has to appear in what the owner just wrote or in the
// recent conversation. That is the difference between checking provenance and
// interpreting meaning — nothing here decides what the owner wanted, only
// whether the model is quoting them or inventing.
//
// An empty name is kept: the prompt asks for one deliberately when a command's
// target is unclear, so that the assistant asks instead of guessing.
func keepDraftsTheOwnerNamed(drafts []AIStockCommandDraft, question string, history []AIConversationMessage) []AIStockCommandDraft {
	if len(drafts) == 0 {
		return drafts
	}
	// Thai has no spaces between words, so a name written into a sentence is
	// simply a substring of it. Spaces are stripped from both sides because the
	// model tends to normalise them and the owner does not.
	said := strings.ReplaceAll(question, " ", "")
	for _, message := range history {
		said += "\n" + strings.ReplaceAll(message.Content, " ", "")
	}
	kept := make([]AIStockCommandDraft, 0, len(drafts))
	for _, draft := range drafts {
		name := strings.ReplaceAll(strings.TrimSpace(draft.Name), " ", "")
		if name == "" || strings.Contains(said, name) {
			kept = append(kept, draft)
			continue
		}
		// Logged rather than dropped silently: a name the owner did say but wrote
		// differently would disappear here, and the log is the only way anyone
		// would find out.
		aiStage("warn", "joyboy command: dropped invented name %q — not in the owner's words", draft.Name)
	}
	return kept
}

// aiRecentTurnsForExtraction renders the last exchanges so a one-word reply can
// be read against what was asked. Kept short: this round only needs the thread
// of the current command, not the conversation's history.
func aiRecentTurnsForExtraction(history []AIConversationMessage) string {
	if len(history) == 0 {
		return ""
	}
	const maxTurns = 4
	start := len(history) - maxTurns
	if start < 0 {
		start = 0
	}
	var builder strings.Builder
	builder.WriteString("(บทสนทนาก่อนหน้า)\n")
	for _, turn := range history[start:] {
		role := "ผู้ใช้"
		if strings.EqualFold(turn.Role, "assistant") {
			role = "ผู้ช่วย"
		}
		builder.WriteString(role + ": " + strings.TrimSpace(turn.Content) + "\n")
	}
	builder.WriteString("\nข้อความล่าสุด: ")
	return builder.String()
}

// ParseStockCommandDrafts reads the model's reply as a JSON array, tolerating a
// code fence or stray prose around it. Anything malformed yields no commands —
// the assistant then answers normally instead of acting on a guess.
func ParseStockCommandDrafts(raw string) ([]AIStockCommandDraft, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, nil
	}
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(strings.TrimSpace(text), "```")

	start := strings.Index(text, "[")
	end := strings.LastIndex(text, "]")
	if start < 0 || end <= start {
		return nil, nil
	}

	var drafts []AIStockCommandDraft
	if err := json.Unmarshal([]byte(text[start:end+1]), &drafts); err != nil {
		return nil, errors.New("ตัวแปลงคำสั่งตอบไม่เป็น JSON")
	}

	cleaned := make([]AIStockCommandDraft, 0, len(drafts))
	for _, draft := range drafts {
		draft.Name = strings.TrimSpace(draft.Name)
		draft.Kind = strings.ToLower(strings.TrimSpace(draft.Kind))
		draft.Unit = strings.TrimSpace(draft.Unit)
		draft.Note = strings.TrimSpace(draft.Note)
		draft.Category = strings.ToLower(strings.TrimSpace(draft.Category))
		draft.Date = strings.TrimSpace(draft.Date)
		draft.Currency = strings.ToUpper(strings.TrimSpace(draft.Currency))
		// A nameless entry is dropped, except when the model kept the owner's own
		// words for it. That is the case where it could tell a command was there
		// but not what it was about — "เพิ่มไข่ไก่ 30 ฟอง แล้วก็เพิ่มของอีกอย่างที่
		// ใกล้หมดด้วย" — and dropping it here is what made the second half vanish
		// with nothing said. It becomes a question to the owner further down, never
		// a write: nothing can be written without a resolved name.
		// A nameless "create" is kept too: "เพิ่มวัตถุดิบ" is a whole command
		// missing only its name, and Go asks for it (25 ก.ย. 2569).
		if draft.Name == "" && draft.Note == "" && !strings.EqualFold(draft.Kind, "create") {
			continue
		}
		// A negative number is kept, not flattened to zero.
		//
		// Zeroing it here made every impossible number look like a number nobody
		// said, so "ตั้งราคาข้าวกะเพราเป็น -50 บาท" reached the resolver as a price
		// of nothing and came back as the bare "ตั้งราคาเท่าไหร่ครับ" — and when the
		// answer round had no data at all it filled the gap with "ผู้ช่วยทำให้ไม่ได้
		// ครับ", which is false: changing a menu price is exactly what it can do.
		// The owner was told the wrong thing was impossible.
		//
		// Bounds are checked in Go against the live shelf, which is where the
		// reason for a refusal is actually known. This layer only reads.
		cleaned = append(cleaned, draft)
	}
	return cleaned, nil
}
