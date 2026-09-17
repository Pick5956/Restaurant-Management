package main

import (
	"fmt"
	"log"
	"math/rand"
	"time"

	"gorm.io/gorm"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Closing yesterday before opening today.
//
// Each seeded day leaves three to five orders live on the floor so the
// assistant's "what is the kitchen doing" has something to show. Nothing ever
// closed them, so after four days the floor carried twenty-two open bills, the
// oldest "waiting" for 5,101 minutes, and every dine-in table stayed occupied
// for good. A real shop closes its bills at the end of the night; so does this.
//
// Only orders this command seeded are touched (the day marker in the note), so
// a bill the owner opened by hand is never closed behind their back.

// settleLeftovers closes every seeded order from a day before `today` that is
// still live: items served, the cooking cost deducted from stock (the live
// orders were created without deductions, so closing is when the kitchen's
// consumption is recorded), the bill marked paid with a payment row, and the
// table released. Deterministic per order so a re-run cannot produce a
// different closing time for the same bill.
func settleLeftovers(db *gorm.DB, restaurantID uint, today string, loc *time.Location,
	ingredients []entity.Ingredient, staffID uint) (int, error) {

	var leftovers []entity.Order
	err := db.Where("restaurant_id = ? AND note LIKE ? AND order_date < ? AND status NOT IN ?",
		restaurantID, "[daily_activity %", today,
		[]string{entity.OrderStatusCompleted, entity.OrderStatusCancelled}).
		Order("opened_at asc").Find(&leftovers).Error
	if err != nil || len(leftovers) == 0 {
		return 0, err
	}

	settled := 0
	err = db.Transaction(func(tx *gorm.DB) error {
		consumed := map[uint]float64{}
		for _, order := range leftovers {
			rng := rand.New(rand.NewSource(int64(order.ID)))
			closedAt := order.OpenedAt.In(loc).Add(time.Duration(25+rng.Intn(46)) * time.Minute)
			// A bill closes on the day it was opened: sales are attributed by
			// completed_at, and a midnight spill would move it to the next day.
			if dayEnd := endOfDay(order.OpenedAt.In(loc)); closedAt.After(dayEnd) {
				closedAt = dayEnd
			}

			var items []entity.OrderItem
			if err := tx.Where("order_id = ?", order.ID).Find(&items).Error; err != nil {
				return err
			}
			for idx := range items {
				item := &items[idx]
				served := closedAt
				if err := tx.Model(item).Updates(map[string]interface{}{
					"status": entity.OrderItemStatusServed, "ready_at": served, "served_at": served, "updated_at": served,
				}).Error; err != nil {
					return err
				}
				deductions, recipes := buildCost(item, ingredients, staffID, rng)
				for _, d := range deductions {
					consumed[d.IngredientID] += d.Quantity
				}
				if len(deductions) > 0 {
					if err := tx.Create(&deductions).Error; err != nil {
						return err
					}
				}
				if len(recipes) > 0 {
					if err := tx.Create(&recipes).Error; err != nil {
						return err
					}
				}
			}

			if err := tx.Model(&entity.Order{}).Where("id = ?", order.ID).Updates(map[string]interface{}{
				"status": entity.OrderStatusCompleted, "payment_status": entity.PaymentStatusPaid,
				"closed_at": closedAt, "completed_at": closedAt, "updated_at": closedAt,
			}).Error; err != nil {
				return err
			}
			if err := tx.Create(seededPayment(order, closedAt, staffID, rng)).Error; err != nil {
				return err
			}
			if order.TableID != nil {
				if err := releaseSeededTable(tx, restaurantID, *order.TableID); err != nil {
					return err
				}
			}
			settled++
		}
		for ingredientID, qty := range consumed {
			if qty <= 0 {
				continue
			}
			if err := tx.Model(&entity.Ingredient{}).
				Where("id = ? AND restaurant_id = ?", ingredientID, restaurantID).
				Update("stock", gorm.Expr("GREATEST(stock - ?, 0)", round2(qty))).Error; err != nil {
				return err
			}
			if err := repository.ReconcileLotsToStock(tx, restaurantID, ingredientID, time.Now()); err != nil {
				return err
			}
		}
		return nil
	})
	return settled, err
}

// backfillPayments writes the payment row for every seeded bill that is paid
// but has none. The day seeder marked bills paid without saying how; the
// order_payments table stayed empty and "จ่ายพร้อมเพย์กับเงินสดอย่างไหนเยอะ" had
// nothing to read. Runs every day and is a no-op once caught up.
func backfillPayments(db *gorm.DB, restaurantID uint, staffID uint) (int, error) {
	var orders []entity.Order
	err := db.Where("restaurant_id = ? AND note LIKE ? AND status = ? AND payment_status = ? AND id NOT IN (?)",
		restaurantID, "[daily_activity %", entity.OrderStatusCompleted, entity.PaymentStatusPaid,
		db.Model(&entity.OrderPayment{}).Select("order_id").Where("restaurant_id = ?", restaurantID)).
		Find(&orders).Error
	if err != nil || len(orders) == 0 {
		return 0, err
	}
	written := 0
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, order := range orders {
			paidAt := order.UpdatedAt
			if order.CompletedAt != nil {
				paidAt = *order.CompletedAt
			}
			rng := rand.New(rand.NewSource(int64(order.ID)))
			if err := tx.Create(seededPayment(order, paidAt, staffID, rng)).Error; err != nil {
				return err
			}
			written++
		}
		return nil
	})
	return written, err
}

// seededPayment is how a seeded bill was paid: mostly cash, PromptPay a bit
// under half the time, which is roughly what a small Thai shop sees. Cash
// customers hand over round notes, so the change is real rather than zero.
func seededPayment(order entity.Order, paidAt time.Time, staffID uint, rng *rand.Rand) *entity.OrderPayment {
	method := "cash"
	received := order.GrandTotal
	if rng.Float64() < 0.45 {
		method = "promptpay_qr"
	} else {
		received = roundUpToNote(order.GrandTotal)
	}
	return &entity.OrderPayment{
		Model:          gorm.Model{CreatedAt: paidAt, UpdatedAt: paidAt},
		OrderID:        order.ID,
		RestaurantID:   order.RestaurantID,
		Method:         method,
		Amount:         order.GrandTotal,
		ReceivedAmount: received,
		ChangeAmount:   round2(received - order.GrandTotal),
		Note:           order.Note,
		PaidBy:         staffID,
		PaidAt:         paidAt,
	}
}

// roundUpToNote is the cash a customer would actually hand over for a bill:
// the next 100 for small bills, the next 500 above that.
func roundUpToNote(amount float64) float64 {
	step := 100.0
	if amount > 500 {
		step = 500.0
	}
	notes := float64(int((amount+step-0.01)/step)) * step
	if notes < amount {
		notes += step
	}
	return notes
}

// releaseSeededTable frees a table once nothing live is left on it, the same
// rule the POS applies when a bill is paid.
func releaseSeededTable(tx *gorm.DB, restaurantID, tableID uint) error {
	var stillOpen int64
	if err := tx.Model(&entity.Order{}).
		Where("restaurant_id = ? AND table_id = ? AND status NOT IN ?", restaurantID, tableID,
			[]string{entity.OrderStatusCompleted, entity.OrderStatusCancelled}).
		Count(&stillOpen).Error; err != nil {
		return err
	}
	if stillOpen > 0 {
		return nil
	}
	return tx.Model(&entity.RestaurantTable{}).Where("id = ?", tableID).
		Update("status", entity.TableStatusFree).Error
}

func endOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 0, 0, t.Location())
}

func reportSettlement(settled, backfilled int) {
	if settled > 0 || backfilled > 0 {
		log.Printf("ปิดบิลค้างของวันก่อน %d บิล · เติมรายการชำระเงินย้อนหลัง %d บิล", settled, backfilled)
	}
}

var _ = fmt.Sprintf
