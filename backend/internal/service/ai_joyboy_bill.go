package service

import (
	"fmt"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Reading one bill.
//
// The shop could be asked what it sold this month, which menu earns most, and
// which tables are still open — but not "ขอดูบิล 20260906-015" or "โต๊ะ 5 เมื่อกี้
// สั่งอะไรไปบ้าง". A bill existed only as a number inside a sum, so the model
// answered from a total, or promised to go and look.
//
// Which bill is meant is resolved the way ai_joyboy_detail.go resolves a named
// menu: the shop's own order numbers are matched against the sentence, longest
// match first, and every hit travels as a candidate. Go never reads the sentence
// for words like "ล่าสุด" or "เมื่อกี้" — it cannot tell those apart, and a word
// list that tries is how the wrong bill gets answered confidently. When nothing
// in the sentence matches a real number, the sheet says so and carries the
// recent bills instead, newest first, for the model to pick from.

// joyboyBillLinesFor caps how many bills travel with their lines. A bill can run
// to twenty dishes, so three is what keeps "ขอดูบิลล่าสุด" answerable in one
// round without sending half a day's orders to the model.
const joyboyBillLinesFor = 3

// joyboyRecentBillRows is how far back the shortlist reaches when the question
// names no bill. Twenty covers "เมื่อกี้" on a busy afternoon and stays short
// enough to read.
const joyboyRecentBillRows = 20

// joyboyBillDetailBody renders the bills the question points at, or the recent
// shortlist when it points at none.
//
// named is what the sentence (or the thread) matched against real order numbers;
// recent is the newest bills regardless. Both come from the repository, so a
// number on this sheet is a number the shop actually issued.
func joyboyBillDetailBody(named, recent []repository.AIBill, partial bool, now time.Time) string {
	if len(named) == 0 && len(recent) == 0 {
		return joyboyNoData("no_bills_recorded")
	}

	lines := []string{
		"scope=one_bill",
		"capability=read_only",
		"note=ดูได้อย่างเดียว แก้บิล ยกเลิกบิล หรือเก็บเงินให้ไม่ได้ ถ้าผู้ใช้ขอให้ทำ ให้บอกว่าต้องไปกดเองที่หน้าคลังออเดอร์",
	}

	if len(named) > 0 {
		if partial {
			lines = append(lines,
				fmt.Sprintf("matched_bill=partial matches=%d", len(named)),
				"note=เลขบิลที่ผู้ใช้เอ่ยตรงกับบิลข้างล่างนี้เพียงบางส่วน ไม่ได้ตรงทั้งเลข "+
					"ถ้ามีหลายใบ ให้ถามกลับว่าหมายถึงใบไหน ห้ามเลือกให้เอง")
		} else {
			lines = append(lines, fmt.Sprintf("matched_bill=exact matches=%d", len(named)))
		}
		lines = append(lines, joyboyBillBlocks(named, now)...)
		return joyboyJoin(lines)
	}

	// Nothing in the sentence matched a real number. Go does not know whether the
	// owner named a bill that does not exist or asked for "the last one" without
	// a number, and it must not guess between the two — so the sheet states the
	// fact and hands over the shortlist.
	lines = append(lines,
		"matched_bill=none",
		"note=หาบิลที่ตรงกับเลขในคำถามไม่เจอ ข้างล่างคือบิลล่าสุดของร้าน เรียงใหม่ไปเก่า "+
			"ถ้าผู้ใช้เอ่ยเลขบิลไว้ แปลว่าไม่มีเลขนั้นในระบบ ให้บอกตรง ๆ แล้วเสนอบิลล่าสุดให้เลือก "+
			"ถ้าผู้ใช้พูดลอย ๆ ว่าบิลล่าสุดหรือบิลเมื่อกี้ ให้ตอบจากใบแรกในรายการ",
		fmt.Sprintf("recent_bills=%d bills_with_items=%d", len(recent), countBillsWithLines(recent)))
	lines = append(lines, joyboyBillBlocks(recent, now)...)
	return joyboyJoin(lines)
}

func countBillsWithLines(bills []repository.AIBill) int {
	count := 0
	for _, bill := range bills {
		if len(bill.Lines) > 0 {
			count++
		}
	}
	return count
}

// joyboyBillBlocks writes each bill as a header line followed by its dishes and
// its money breakdown. A bill without lines is still listed — it is a real bill,
// and dropping it would tell the owner it does not exist.
func joyboyBillBlocks(bills []repository.AIBill, now time.Time) []string {
	lines := make([]string, 0, len(bills)*4)
	for _, bill := range bills {
		lines = append(lines, joyboyBillHeadline(bill, now))
		for _, item := range bill.Lines {
			line := fmt.Sprintf("  line=%s x%d ราคาต่อหน่วย=%s รวม=%s",
				item.MenuName, item.Quantity, joyboyNum(item.UnitPrice), joyboyNum(item.Subtotal))
			if item.Status == entity.OrderItemStatusCancelled {
				line += " สถานะ=ยกเลิกรายการนี้ (ไม่ถูกคิดเงิน)"
			}
			if note := strings.TrimSpace(item.Note); note != "" {
				line += " หมายเหตุ=" + note
			}
			lines = append(lines, line)
		}
		lines = append(lines, "  "+joyboyBillMoneyLine(bill))
	}
	return lines
}

// joyboyBillHeadline is the one line that identifies a bill: which bill, when,
// where, who, and what state it is in.
func joyboyBillHeadline(bill repository.AIBill, now time.Time) string {
	where := strings.TrimSpace(bill.TableNumber)
	if where == "" {
		where = "สั่งกลับบ้าน"
	} else {
		where = "โต๊ะ " + where
	}
	status := aiOrderStatusThai[bill.Status]
	switch bill.Status {
	case entity.OrderStatusCompleted:
		status = "ปิดบิลแล้ว"
	case entity.OrderStatusCancelled:
		status = "ยกเลิกทั้งบิล"
	}
	if status == "" {
		status = bill.Status
	}
	payment := map[string]string{"unpaid": "ยังไม่จ่าย", "paid": "จ่ายแล้ว"}[bill.PaymentStatus]
	if payment == "" {
		payment = bill.PaymentStatus
	}
	if method := aiPaymentMethodThai(strings.TrimSpace(bill.PaymentMethod)); method != "" {
		payment += " ทาง" + method
	} else if bill.PaymentStatus == entity.PaymentStatusPaid {
		// The bill says paid and no payment row exists, which is true of every
		// bill closed before the shop started recording how. Saying it out loud
		// stops the model inventing "จ่ายเงินสด".
		payment += " (ไม่ได้บันทึกว่าจ่ายทางไหน)"
	}

	line := fmt.Sprintf("bill=%s เปิดบิล=%s %s ที่=%s ประเภท=%s สถานะ=%s การชำระ=%s คน=%d รายการ=%d ยอดสุทธิ=%s",
		bill.OrderNumber,
		formatThaiDate(bill.OpenedAt.In(now.Location()).Format("2006-01-02")),
		bill.OpenedAt.In(now.Location()).Format("15:04"), where,
		aiOrderTypeThai(bill.OrderType), status, payment,
		bill.CustomerCount, len(bill.Lines), joyboyNum(bill.GrandTotal))
	if bill.CompletedAt != nil {
		line += " ปิดบิล=" + bill.CompletedAt.In(now.Location()).Format("15:04")
	}
	if reason := strings.TrimSpace(bill.CancelledReason); reason != "" {
		line += " เหตุผลที่ยกเลิก=" + reason
	}
	if staff := strings.TrimSpace(bill.StaffName); staff != "" {
		line += " พนักงาน=" + staff
	}
	return line
}

// joyboyBillMoneyLine spells out how the total was reached. Only the parts the
// shop actually charged appear: a shop with VAT switched off should not read a
// "VAT = 0.00" line and conclude it has one.
func joyboyBillMoneyLine(bill repository.AIBill) string {
	parts := []string{"ยอดอาหาร=" + joyboyNum(bill.Subtotal)}
	if bill.ServiceChargeAmount > 0 {
		parts = append(parts, "เซอร์วิสชาร์จ=+"+joyboyNum(bill.ServiceChargeAmount))
	}
	if bill.VATAmount > 0 {
		parts = append(parts, "VAT=+"+joyboyNum(bill.VATAmount))
	}
	parts = append(parts, "ยอดสุทธิ="+joyboyNum(bill.GrandTotal))
	return "money=" + strings.Join(parts, " ")
}

// joyboyBillNumbers pulls the order numbers out of a shortlist so they can be
// matched against the question — the same shape ai_joyboy_detail.go matches menu
// names in.
func joyboyBillNumbers(bills []repository.AIBill) []string {
	numbers := make([]string, 0, len(bills))
	for _, bill := range bills {
		numbers = append(numbers, bill.OrderNumber)
	}
	return numbers
}
