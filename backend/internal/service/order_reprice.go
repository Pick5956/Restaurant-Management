package service

import (
	"log"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// RepriceOpenOrders prices every order still being served again, from the
// restaurant's current promotions and bill settings, one transaction per order
// so a busy till is never held for long. It returns the orders whose stored
// money moved, for the caller to announce as order.repriced.
//
// An order that fails here is priced again by its next change and, at the
// latest, inside PayOrder, so the failure is logged (under `cause`) rather than
// turned into a failed save of whatever changed the prices.
func RepriceOpenOrders(orders *repository.OrderRepository, restaurantID uint, cause string) []uint {
	ids, err := orders.ListRepriceableOrderIDs(restaurantID)
	if err != nil {
		log.Printf("%s_reprice_list_failed restaurant_id=%d error=%v", cause, restaurantID, err)
		return nil
	}
	repriced := make([]uint, 0, len(ids))
	for _, orderID := range ids {
		changed := false
		err := orders.Transaction(func(tx *repository.OrderRepository) error {
			order, err := tx.LockOrderForPricing(restaurantID, orderID)
			if err != nil {
				return err
			}
			if order.PaymentStatus == entity.PaymentStatusPaid ||
				order.Status == entity.OrderStatusCompleted ||
				order.Status == entity.OrderStatusCancelled {
				return nil
			}
			changed, err = priceOrder(tx, order)
			if err != nil || !changed {
				return err
			}
			return tx.SaveOrder(order)
		})
		if err != nil {
			log.Printf("%s_reprice_failed restaurant_id=%d order_id=%d error=%v", cause, restaurantID, orderID, err)
			continue
		}
		if changed {
			repriced = append(repriced, orderID)
		}
	}
	return repriced
}

// BillChargesChanged reports whether a settings save moved anything an open
// bill is priced from. An open order stores its service charge and VAT, so a
// change here has to reprice them, the way a promotion change does.
func BillChargesChanged(before, after *entity.Restaurant) bool {
	if before == nil || after == nil {
		return before != after
	}
	return before.ServiceChargeEnabled != after.ServiceChargeEnabled ||
		before.ServiceChargeRate != after.ServiceChargeRate ||
		before.VATEnabled != after.VATEnabled ||
		before.VATRate != after.VATRate
}
