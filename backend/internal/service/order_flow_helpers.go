package service

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

func roundMoney(value float64) float64 {
	return math.Round(value*100) / 100
}

// ensureMenuCapacity blocks an order that would claim more portions than current
// stock can still promise for a recipe-limited menu. addQty is the extra portions
// being placed. Menus without a recipe are unlimited and always pass. It must run
// inside a transaction that already holds the per-restaurant order lock
// (LockRestaurantOrderCounter) so two concurrent orders cannot both pass this check
// and oversell the same ingredient.
func ensureMenuCapacity(tx *repository.OrderRepository, restaurantID, menuID uint, menuName string, addQty int) error {
	if addQty <= 0 {
		return nil
	}
	remaining, err := tx.MenuRemainingServings(restaurantID)
	if err != nil {
		return err
	}
	left, ok := remaining[menuID]
	if !ok || addQty <= left {
		return nil
	}
	if left <= 0 {
		return fmt.Errorf("%s is sold out", menuName)
	}
	return fmt.Errorf("only %d left for %s", left, menuName)
}

func refreshOrderStatusFromItems(tx *repository.OrderRepository, order *entity.Order, userID uint) error {
	if order == nil || isTerminalOrder(order.Status) {
		return nil
	}
	items, err := tx.ListItems(order.ID)
	if err != nil {
		return err
	}
	if shouldAutoCancelTakeawayOrder(order, items) {
		const reason = "all takeaway items cancelled"
		now := repository.BangkokNow()
		order.CancelledReason = reason
		order.ClosedAt = &now
		return setOrderStatus(tx, order, entity.OrderStatusCancelled, userID, reason)
	}
	next := orderStatusFromItems(order.Status, items)
	if next == order.Status {
		return nil
	}
	note := "items in kitchen"
	switch next {
	case entity.OrderStatusServed:
		note = "all items served"
	case entity.OrderStatusReady:
		note = "all remaining items ready"
	}
	return setOrderStatus(tx, order, next, userID, note)
}

func shouldAutoCancelTakeawayOrder(order *entity.Order, items []entity.OrderItem) bool {
	return order != nil &&
		order.OrderType == entity.OrderTypeTakeaway &&
		len(items) > 0 &&
		allItems(items, entity.OrderItemStatusCancelled)
}

func effectiveOrderStatus(order *entity.Order) string {
	if order == nil {
		return ""
	}
	if isTerminalOrder(order.Status) {
		return order.Status
	}
	return orderStatusFromItems(order.Status, order.Items)
}

func applyEffectiveOrderStatus(order *entity.Order) {
	if order != nil {
		order.Status = effectiveOrderStatus(order)
	}
}

func orderStatusFromItems(current string, items []entity.OrderItem) string {
	active := make([]entity.OrderItem, 0, len(items))
	for _, item := range items {
		if item.Status != entity.OrderItemStatusCancelled {
			active = append(active, item)
		}
	}
	if len(active) == 0 {
		// Every item was cancelled (or none were ever added), so the table is
		// empty again. Fall back to "open" instead of leaving a stale kitchen
		// status that would block both payment and closing the empty table.
		return entity.OrderStatusOpen
	}
	if allItems(active, entity.OrderItemStatusServed) {
		return entity.OrderStatusServed
	}
	remaining := make([]entity.OrderItem, 0, len(active))
	for _, item := range active {
		if item.Status != entity.OrderItemStatusServed {
			remaining = append(remaining, item)
		}
	}
	if len(remaining) > 0 && allItems(remaining, entity.OrderItemStatusReady) {
		return entity.OrderStatusReady
	}
	if current == entity.OrderStatusSentToKitchen && anyItem(remaining, entity.OrderItemStatusCooking) {
		return current
	}
	if anyItem(remaining, entity.OrderItemStatusCooking) || anyItem(remaining, entity.OrderItemStatusReady) {
		return entity.OrderStatusCooking
	}
	return current
}

func sendPendingItemsToKitchen(tx *repository.OrderRepository, order *entity.Order, userID uint) error {
	return sendPendingItemsToKitchenByIDs(tx, order, userID, nil)
}

func sendPendingItemsToKitchenByIDs(tx *repository.OrderRepository, order *entity.Order, userID uint, itemIDs []uint) error {
	now := repository.BangkokNow()
	maxBatch, err := tx.MaxKitchenBatch(order.ID)
	if err != nil {
		return err
	}
	nextBatch := maxBatch + 1
	validItemIDs := make([]uint, 0, len(itemIDs))
	for _, id := range itemIDs {
		if id != 0 {
			validItemIDs = append(validItemIDs, id)
		}
	}
	pendingCount, err := tx.MarkPendingItemsSent(order.ID, validItemIDs, now, nextBatch)
	if err != nil {
		return err
	}
	if pendingCount == 0 {
		return errors.New("no pending items to send")
	}
	return setOrderStatus(tx, order, entity.OrderStatusSentToKitchen, userID, fmt.Sprintf("sent batch %d to kitchen", nextBatch))
}

func deductInventoryForCompletedKitchenItem(tx *repository.OrderRepository, restaurantID, userID uint, order *entity.Order, item *entity.OrderItem) error {
	snapshots, err := tx.ListItemRecipeSnapshots(restaurantID, item.ID)
	if err != nil {
		return err
	}
	if len(snapshots) == 0 {
		return nil
	}
	deductedIngredientIDs := make([]uint, 0, len(snapshots))
	for _, snapshot := range snapshots {
		required := snapshot.QuantityPerItem * float64(item.Quantity)
		if required <= 0 {
			continue
		}
		alreadyDeducted, err := tx.HasInventoryDeduction(item.ID, snapshot.IngredientID)
		if err != nil {
			return err
		}
		if alreadyDeducted {
			continue
		}
		ingredient, err := tx.FindIngredientForUpdate(restaurantID, snapshot.IngredientID)
		if err != nil {
			return err
		}
		if ingredient.Stock < required {
			return fmt.Errorf("%s stock is not enough for %s", snapshot.IngredientName, item.MenuName)
		}
		ingredient.Stock -= required
		if err := tx.SaveIngredient(ingredient); err != nil {
			return err
		}
		deductedIngredientIDs = append(deductedIngredientIDs, ingredient.ID)
		cost := recipeComponentCost(required, snapshot.CostPerUnit, snapshot.YieldPercent)
		deduction := &entity.OrderInventoryDeduction{
			RestaurantID: restaurantID,
			OrderID:      order.ID,
			OrderItemID:  item.ID,
			MenuItemID:   item.MenuID,
			IngredientID: ingredient.ID,
			Quantity:     required,
			CostSnapshot: cost,
			// Reads on the phone as "ตัดอัตโนมัติ · ORD-0042 · ผัดกะเพราหมู": the
			// answer to "why did this stock disappear", in the language of the
			// person asking. The menu name in it was always Thai regardless.
			Note:         fmt.Sprintf("ตัดอัตโนมัติ · %s · %s", order.OrderNumber, item.MenuName),
			CreatedByID:  userID,
		}
		if err := tx.CreateInventoryDeduction(deduction); err != nil {
			return err
		}
		stockTx := &entity.IngredientTransaction{
			RestaurantID: restaurantID,
			IngredientID: ingredient.ID,
			Type:         "out",
			Quantity:     required,
			Note:         deduction.Note,
			CreatedByID:  userID,
		}
		if err := tx.CreateIngredientTransaction(stockTx); err != nil {
			return err
		}
	}
	// A dish that just consumed the last of an ingredient can no longer be made,
	// so switch off its menu automatically. Re-opening stays a manual decision.
	if _, err := tx.DisableMenusForDepletedIngredients(restaurantID, deductedIngredientIDs); err != nil {
		return err
	}
	return nil
}

func finalizeReadyItemsForPayment(tx *repository.OrderRepository, restaurantID, userID uint, order *entity.Order) error {
	now := repository.BangkokNow()
	for index := range order.Items {
		item := &order.Items[index]
		if item.Status != entity.OrderItemStatusReady {
			continue
		}
		if err := deductInventoryForCompletedKitchenItem(tx, restaurantID, userID, order, item); err != nil {
			return err
		}
		item.Status = entity.OrderItemStatusServed
		item.ServedAt = &now
		if err := tx.SaveItem(item); err != nil {
			return err
		}
	}
	return nil
}

func recipeComponentCost(quantity, costPerUnit, yieldPercent float64) float64 {
	if quantity <= 0 || costPerUnit <= 0 {
		return 0
	}
	if yieldPercent <= 0 {
		yieldPercent = 100
	}
	return roundMoney(quantity * costPerUnit / (yieldPercent / 100))
}

func setOrderStatus(tx *repository.OrderRepository, order *entity.Order, next string, userID uint, note string) error {
	if order.Status == next {
		return tx.SaveOrder(order)
	}
	from := order.Status
	order.Status = next
	if err := tx.SaveOrder(order); err != nil {
		return err
	}
	return tx.CreateStatusLog(statusLog(order.ID, from, next, userID, note))
}

func statusLog(orderID uint, from, to string, userID uint, note string) *entity.OrderStatusLog {
	return &entity.OrderStatusLog{
		OrderID:    orderID,
		FromStatus: from,
		ToStatus:   to,
		ChangedBy:  userID,
		ChangedAt:  repository.BangkokNow(),
		Note:       strings.TrimSpace(note),
	}
}

func normalizeOrderType(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return entity.OrderTypeDineIn, nil
	}
	switch normalized {
	case entity.OrderTypeDineIn, entity.OrderTypeTakeaway:
		return normalized, nil
	default:
		return "", errors.New("invalid order type")
	}
}

func normalizeOrderItemFulfillment(value, orderType string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		if orderType == entity.OrderTypeTakeaway {
			return entity.OrderItemFulfillmentTakeaway, nil
		}
		return entity.OrderItemFulfillmentDineIn, nil
	}
	switch normalized {
	case entity.OrderItemFulfillmentDineIn, entity.OrderItemFulfillmentTakeaway:
		return normalized, nil
	default:
		return "", errors.New("invalid item fulfillment type")
	}
}

func releaseTableIfNoOpenOrder(tx *repository.OrderRepository, restaurantID uint, tableID *uint) error {
	if tableID == nil || *tableID == 0 {
		return nil
	}
	id := *tableID
	hasOpen, err := tx.HasOpenOrderForTable(restaurantID, id)
	if err != nil {
		return err
	}
	if hasOpen {
		return nil
	}
	// One column, not the whole row. See ReleaseTableStatus: reading the table and
	// saving it back reverted any edit made to it in between.
	return tx.ReleaseTableStatus(restaurantID, id)
}

func isTerminalOrder(status string) bool {
	return status == entity.OrderStatusCompleted || status == entity.OrderStatusCancelled
}

func canTransitionItem(from, to string) bool {
	switch from {
	case entity.OrderItemStatusPending:
		return to == entity.OrderItemStatusCooking || to == entity.OrderItemStatusCancelled
	case entity.OrderItemStatusCooking:
		return to == entity.OrderItemStatusReady || to == entity.OrderItemStatusCancelled
	case entity.OrderItemStatusReady:
		return to == entity.OrderItemStatusCooking || to == entity.OrderItemStatusServed || to == entity.OrderItemStatusCancelled
	case entity.OrderItemStatusServed:
		// A served item can still be voided (with a reason) during checkout —
		// e.g. staff keyed it by mistake or the guest never received it.
		return to == entity.OrderItemStatusCancelled
	case entity.OrderItemStatusCancelled:
		return false
	default:
		return false
	}
}

func allItems(items []entity.OrderItem, status string) bool {
	for _, item := range items {
		if item.Status != status {
			return false
		}
	}
	return true
}

func anyItem(items []entity.OrderItem, status string) bool {
	for _, item := range items {
		if item.Status == status {
			return true
		}
	}
	return false
}
