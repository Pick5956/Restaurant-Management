package service

import (
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

func aiTestBillNow() time.Time {
	return time.Date(2026, 9, 6, 15, 0, 0, 0, aiTestBangkok())
}

func aiTestBangkok() *time.Location {
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return time.FixedZone("ICT", 7*3600)
	}
	return loc
}

func aiTestBill() repository.AIBill {
	closed := time.Date(2026, 9, 6, 13, 12, 0, 0, aiTestBangkok())
	return repository.AIBill{
		OrderNumber:   "20260906-015",
		OrderType:     "dine_in",
		Status:        entity.OrderStatusCompleted,
		PaymentStatus: entity.PaymentStatusPaid,
		TableNumber:   "A2",
		StaffName:     "สมหญิง",
		CustomerCount: 3,
		Subtotal:      520,
		GrandTotal:    520,
		OpenedAt:      time.Date(2026, 9, 6, 12, 30, 0, 0, aiTestBangkok()),
		CompletedAt:   &closed,
		PaymentMethod: "promptpay_qr",
		Lines: []repository.AIBillLine{
			{MenuName: "ผัดไทยกุ้งสด", Quantity: 2, UnitPrice: 89, Subtotal: 178, Status: entity.OrderItemStatusServed},
			{MenuName: "ต้มยำกุ้ง", Quantity: 1, UnitPrice: 220, Subtotal: 220, Status: entity.OrderItemStatusServed, Note: "ไม่เผ็ด"},
			{MenuName: "ชาไทยเย็น", Quantity: 2, UnitPrice: 61, Subtotal: 122, Status: entity.OrderItemStatusServed},
		},
	}
}

// A bill the owner named comes back whole: the dishes, what each cost, and the
// facts that identify the bill. Answering "ขอดูบิล 20260906-015" from a total
// was the failure this tool exists for.
func TestJoyboyBillDetailBodyNamedBill(t *testing.T) {
	body := joyboyBillDetailBody([]repository.AIBill{aiTestBill()}, nil, false, aiTestBillNow())

	for _, want := range []string{
		"matched_bill=exact matches=1",
		"bill=20260906-015",
		"เปิดบิล=6 กันยายน 2569 12:30",
		"ปิดบิล=13:12",
		"ที่=โต๊ะ A2",
		"ประเภท=กินที่ร้าน",
		"สถานะ=ปิดบิลแล้ว",
		"การชำระ=จ่ายแล้ว ทางพร้อมเพย์",
		"คน=3",
		"รายการ=3",
		"line=ผัดไทยกุ้งสด x2 ราคาต่อหน่วย=89.00 รวม=178.00",
		"หมายเหตุ=ไม่เผ็ด",
		"พนักงาน=สมหญิง",
		"money=ยอดอาหาร=520.00 ยอดสุทธิ=520.00",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("bill sheet missing %q:\n%s", want, body)
		}
	}
}

// A shop with no VAT and no discount must not read zero lines for either — a
// "VAT=0.00" on the sheet is how an answer starts explaining a tax the shop
// does not charge.
func TestJoyboyBillDetailBodyOmitsChargesTheShopDidNotMake(t *testing.T) {
	body := joyboyBillDetailBody([]repository.AIBill{aiTestBill()}, nil, false, aiTestBillNow())

	for _, unwanted := range []string{"VAT=", "ส่วนลด=", "เซอร์วิสชาร์จ="} {
		if strings.Contains(body, unwanted) {
			t.Errorf("sheet spells out %q on a bill that carried none:\n%s", unwanted, body)
		}
	}

	charged := aiTestBill()
	charged.ServiceChargeAmount = 50
	charged.VATAmount = 38.5
	charged.GrandTotal = 588.5
	withCharges := joyboyBillDetailBody([]repository.AIBill{charged}, nil, false, aiTestBillNow())
	for _, want := range []string{"เซอร์วิสชาร์จ=+50.00", "VAT=+38.50", "ยอดสุทธิ=588.50"} {
		if !strings.Contains(withCharges, want) {
			t.Errorf("sheet missing %q on a bill that was charged it:\n%s", want, withCharges)
		}
	}
}

// A line struck off the bill stays on the sheet, marked. Hiding it is how
// "ทำไมยอดไม่ตรงกับที่สั่ง" becomes unanswerable.
func TestJoyboyBillDetailBodyKeepsCancelledLines(t *testing.T) {
	bill := aiTestBill()
	bill.Lines = append(bill.Lines, repository.AIBillLine{
		MenuName: "ข้าวผัดปู", Quantity: 1, UnitPrice: 150, Subtotal: 150,
		Status: entity.OrderItemStatusCancelled,
	})
	body := joyboyBillDetailBody([]repository.AIBill{bill}, nil, false, aiTestBillNow())

	if !strings.Contains(body, "line=ข้าวผัดปู x1") {
		t.Errorf("a cancelled dish was dropped from the bill:\n%s", body)
	}
	if !strings.Contains(body, "สถานะ=ยกเลิกรายการนี้ (ไม่ถูกคิดเงิน)") {
		t.Errorf("a cancelled dish is listed as if it was charged:\n%s", body)
	}
}

// A bill marked paid with no payment row is every bill closed before the shop
// started recording how. The sheet has to say the method is unknown, or the
// model writes "จ่ายเงินสด" over nothing.
func TestJoyboyBillDetailBodySaysWhenPaymentMethodIsUnknown(t *testing.T) {
	bill := aiTestBill()
	bill.PaymentMethod = ""
	body := joyboyBillDetailBody([]repository.AIBill{bill}, nil, false, aiTestBillNow())

	if !strings.Contains(body, "การชำระ=จ่ายแล้ว (ไม่ได้บันทึกว่าจ่ายทางไหน)") {
		t.Errorf("sheet does not admit the payment method is missing:\n%s", body)
	}
}

// Half a number matched several bills. The sheet must hand them over as
// candidates and say the model has to ask — picking one would answer a
// different table's bill with full confidence.
func TestJoyboyBillDetailBodyPartialMatchAsksBack(t *testing.T) {
	first := aiTestBill()
	second := aiTestBill()
	second.OrderNumber = "20260906-016"
	second.TableNumber = "A3"

	body := joyboyBillDetailBody([]repository.AIBill{first, second}, nil, true, aiTestBillNow())

	if !strings.Contains(body, "matched_bill=partial matches=2") {
		t.Errorf("a half-matched number is not marked as partial:\n%s", body)
	}
	if !strings.Contains(body, "ให้ถามกลับว่าหมายถึงใบไหน ห้ามเลือกให้เอง") {
		t.Errorf("sheet does not tell the model to ask which bill:\n%s", body)
	}
	for _, want := range []string{"bill=20260906-015", "bill=20260906-016"} {
		if !strings.Contains(body, want) {
			t.Errorf("candidate %q missing from the sheet:\n%s", want, body)
		}
	}
}

// Nothing in the sentence matched a real number. Go cannot tell "the last one"
// from a number the shop never issued, so it says neither: the sheet reports no
// match and carries the recent bills for the model to choose from.
func TestJoyboyBillDetailBodyFallsBackToRecentBills(t *testing.T) {
	newest := aiTestBill()
	older := aiTestBill()
	older.OrderNumber = "20260906-014"
	older.Lines = nil

	body := joyboyBillDetailBody(nil, []repository.AIBill{newest, older}, false, aiTestBillNow())

	for _, want := range []string{
		"matched_bill=none",
		"recent_bills=2 bills_with_items=1",
		"bill=20260906-015",
		"bill=20260906-014",
		"ถ้าผู้ใช้พูดลอย ๆ ว่าบิลล่าสุดหรือบิลเมื่อกี้ ให้ตอบจากใบแรกในรายการ",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("fallback sheet missing %q:\n%s", want, body)
		}
	}
	// The bill with no lines is still listed rather than dropped: it is a real
	// bill, and leaving it out tells the owner it does not exist.
	if !strings.Contains(body, "bill=20260906-014") {
		t.Errorf("a bill without line items was dropped:\n%s", body)
	}
}

// A shop that has never opened a bill is not a lookup failure, and the sheet
// has to separate the two.
func TestJoyboyBillDetailBodyNoBillsAtAll(t *testing.T) {
	body := joyboyBillDetailBody(nil, nil, false, aiTestBillNow())

	if !strings.Contains(body, "status=no_data reason=no_bills_recorded") {
		t.Errorf("an empty shop is not reported as having no bills:\n%s", body)
	}
	if !strings.Contains(body, "ยังไม่เคยมีการเปิดบิลเลย") {
		t.Errorf("the no-data note does not say what the answer is:\n%s", body)
	}
}

// A takeaway bill has no table, and "โต๊ะ " with nothing after it reads as a
// missing figure rather than as a bill nobody sat down for.
func TestJoyboyBillDetailBodyTakeawayHasNoTable(t *testing.T) {
	bill := aiTestBill()
	bill.OrderType = "takeaway"
	bill.TableNumber = ""
	body := joyboyBillDetailBody([]repository.AIBill{bill}, nil, false, aiTestBillNow())

	if !strings.Contains(body, "ที่=สั่งกลับบ้าน") {
		t.Errorf("a takeaway bill is not marked as one:\n%s", body)
	}
}

// The lookup is a read. Asked to void a line or take payment, the assistant has
// to say where the owner does it, not report it done.
func TestJoyboyBillDetailBodyStatesItCannotChangeTheBill(t *testing.T) {
	body := joyboyBillDetailBody([]repository.AIBill{aiTestBill()}, nil, false, aiTestBillNow())

	if !strings.Contains(body, "capability=read_only") {
		t.Errorf("bill sheet does not declare itself read-only:\n%s", body)
	}
	if !strings.Contains(body, "ต้องไปกดเองที่หน้าคลังออเดอร์") {
		t.Errorf("bill sheet does not say where the owner does it:\n%s", body)
	}
}

// The numbers handed to the matcher are the shop's own, in the order the
// shortlist came back — the matcher indexes into that same slice.
func TestJoyboyBillNumbersKeepsOrder(t *testing.T) {
	numbers := joyboyBillNumbers([]repository.AIBill{
		{OrderNumber: "20260906-015"}, {OrderNumber: "20260906-014"},
	})
	if len(numbers) != 2 || numbers[0] != "20260906-015" || numbers[1] != "20260906-014" {
		t.Errorf("order numbers came back reordered or short: %v", numbers)
	}
}

// The whole point of matching against real numbers: a bill named in the
// sentence is found, and a sentence naming none returns nothing rather than a
// guess. This is the same helper the menu lookup uses, exercised on bill
// numbers because that is a different shape of string.
func TestBillNumbersResolveFromTheQuestion(t *testing.T) {
	numbers := []string{"20260906-015", "20260906-014", "20260905-088"}

	rows, partial := aiFindNamedRowsInThread(numbers, "ขอดูบิล 20260906-015 หน่อย", nil)
	if len(rows) != 1 || rows[0] != 0 || partial {
		t.Fatalf("a fully written bill number did not resolve exactly: rows=%v partial=%v", rows, partial)
	}

	rows, _ = aiFindNamedRowsInThread(numbers, "บิลล่าสุดสั่งอะไรไปบ้าง", nil)
	if len(rows) != 0 {
		t.Errorf("a sentence naming no bill matched %v — Go must not guess which bill \"ล่าสุด\" means", rows)
	}
}
