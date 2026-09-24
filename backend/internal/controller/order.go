package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/realtime"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type OrderController struct {
	orderSvc               *service.OrderService
	orderEvents            *realtime.OrderHub
	eventHeartbeatInterval time.Duration
	eventSessionLifetime   time.Duration
}

const (
	defaultOrderEventHeartbeatInterval = 15 * time.Second
	defaultOrderEventSessionLifetime   = 5 * time.Minute
)

func ProvideOrderController(db *gorm.DB, orderEvents *realtime.OrderHub) *OrderController {
	return &OrderController{
		orderSvc:               service.ProvideOrderService(repository.NewOrderRepository(db)),
		orderEvents:            orderEvents,
		eventHeartbeatInterval: defaultOrderEventHeartbeatInterval,
		eventSessionLifetime:   defaultOrderEventSessionLifetime,
	}
}

func (ctrl *OrderController) publishOrderChange(restaurantID uint, action string, order *entity.Order) {
	if ctrl.orderEvents == nil || order == nil {
		return
	}
	ctrl.orderEvents.Publish(restaurantID, action, order.ID)
}

func requireOrderAccess(c *gin.Context, permission string) bool {
	if memberCan(c, permission) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "missing " + permission + " permission"})
	return false
}

func normalizedOrderListStatus(c *gin.Context) string {
	return strings.TrimSpace(c.Query("status"))
}

func requireOrderListAccess(c *gin.Context) bool {
	if memberCan(c, "view_orders") {
		return true
	}
	if memberCan(c, "take_order") &&
		normalizedOrderListStatus(c) == "active" &&
		c.Query("include_summary") != "true" {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "missing view_orders permission or operational take_order query"})
	return false
}

func requireOrderReadAccess(c *gin.Context) bool {
	return requireAnyPermission(
		c,
		"missing view_orders, take_order, or take_payment permission",
		"view_orders",
		"take_order",
		"take_payment",
	)
}

func requireOrderItemStatusAccess(c *gin.Context, status string) (service.OrderItemStatusActor, bool) {
	if memberCan(c, "update_order_status") {
		return service.OrderItemStatusActorKitchenManager, true
	}
	if memberCan(c, "take_order") &&
		(status == entity.OrderItemStatusServed || status == entity.OrderItemStatusCancelled) {
		return service.OrderItemStatusActorFrontOfHouse, true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "missing permission for this order item status transition"})
	return "", false
}

// requireOrderCancelAccess: once an order has gone to the kitchen, cancelling
// the whole of it throws away cooked food or an unpaid bill, so it takes the
// supervisory permission every other status change takes. Anyone else may
// cancel only an order none of whose live lines has left pending - judged by
// its lines, because a served order reads "open" again once a new line is
// added. Lines voided one by one at the bill, each with a reason, are the
// front-of-house void and are not this gate's concern. The test is the
// permission, not the role name: the seeded cashier and every custom role
// pass the take_order gate without being a "waiter". The service checks the
// same rule again under the row lock.
func requireOrderCancelAccess(c *gin.Context, order *entity.Order) bool {
	if memberCan(c, "update_order_status") || service.OrderNeverReachedKitchen(order) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": service.ErrOrderCancelNeedsSupervisor.Error()})
	return false
}

func (ctrl *OrderController) CreateOrder(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_order") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req service.OpenOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.OpenOrder(restaurantID, userID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, order)
	ctrl.publishOrderChange(restaurantID, "order.created", order)
}

func (ctrl *OrderController) ListOrders(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderListAccess(c) {
		return
	}
	tableID, ok := optionalUintQuery(c, "table_id", "invalid table_id")
	if !ok {
		return
	}
	page := boundedQueryInt(c, "page", 1, 1, 1000)
	limit := boundedQueryInt(c, "limit", 100, 1, 200)
	includeSummary := c.Query("include_summary") == "true"
	status := normalizedOrderListStatus(c)
	orderDate := strings.TrimSpace(c.Query("date"))
	paymentStatus := strings.TrimSpace(c.Query("payment_status"))
	search := strings.TrimSpace(c.Query("search"))
	if err := service.ValidateOrderListFilters(
		status,
		orderDate,
		paymentStatus,
		search,
	); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	result, err := ctrl.orderSvc.ListOrders(
		restaurantID,
		status,
		tableID,
		orderDate,
		paymentStatus,
		search,
		includeSummary,
		page,
		limit,
	)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	payload := gin.H{
		"orders": result.Orders,
		"pagination": gin.H{
			"page":     page,
			"limit":    limit,
			"total":    result.Total,
			"has_more": int64(page*limit) < result.Total,
		},
	}
	if includeSummary {
		payload["summary"] = result.Summary
	}
	c.JSON(http.StatusOK, payload)
}

// resolveOrder accepts either a numeric database ID (backward compat) or an
// order_number string such as "A001" and returns the matching order.
func (ctrl *OrderController) resolveOrder(c *gin.Context, restaurantID uint) (*entity.Order, bool) {
	raw := strings.TrimSpace(c.Param("id"))
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing order id"})
		return nil, false
	}
	// If the param is purely numeric treat it as a database ID (legacy / internal calls).
	if n, err := strconv.ParseUint(raw, 10, 64); err == nil {
		order, err := ctrl.orderSvc.GetOrder(restaurantID, uint(n))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
			return nil, false
		}
		return order, true
	}
	// Otherwise treat it as an order_number string.
	order, err := ctrl.orderSvc.GetOrderByNumber(restaurantID, strings.ToUpper(raw))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return nil, false
	}
	return order, true
}

func (ctrl *OrderController) GetOrder(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderReadAccess(c) {
		return
	}
	order, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, order)
}

func (ctrl *OrderController) UpdateOrder(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_order") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	var req service.UpdateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.UpdateOrder(restaurantID, userID, resolved.ID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "order.updated", order)
}

func (ctrl *OrderController) CancelOrder(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_order") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	if !requireOrderCancelAccess(c, resolved) {
		return
	}
	var req service.CancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.CancelOrder(restaurantID, userID, resolved.ID, req.Reason, memberCan(c, "update_order_status"))
	if err != nil {
		if errors.Is(err, service.ErrOrderCancelNeedsSupervisor) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "order.cancelled", order)
}

func (ctrl *OrderController) CloseEmptyTable(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_order") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	order, err := ctrl.orderSvc.CloseEmptyTable(restaurantID, userID, resolved.ID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "order.closed", order)
}

func (ctrl *OrderController) Bill(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderReadAccess(c) {
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	bill, err := ctrl.orderSvc.Bill(restaurantID, resolved.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return
	}
	c.JSON(http.StatusOK, bill)
}

func (ctrl *OrderController) PayOrder(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_payment") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	var req service.PayOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.PayOrder(restaurantID, userID, resolved.ID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "order.paid", order)
}

func (ctrl *OrderController) AddItem(c *gin.Context) {
	restaurantID, orderID, ok := ctrl.orderIDContext(c, "take_order")
	if !ok {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req service.AddOrderItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.AddItem(restaurantID, userID, orderID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, order)
	ctrl.publishOrderChange(restaurantID, "item.added", order)
}

func (ctrl *OrderController) UpdateItem(c *gin.Context) {
	restaurantID, orderID, ok := ctrl.orderIDContext(c, "take_order")
	if !ok {
		return
	}
	itemID, ok := parseUintParam(c, "itemId")
	if !ok {
		return
	}
	var req service.UpdateOrderItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	order, err := ctrl.orderSvc.UpdateItem(restaurantID, orderID, itemID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "item.updated", order)
}

func (ctrl *OrderController) DeleteItem(c *gin.Context) {
	restaurantID, orderID, ok := ctrl.orderIDContext(c, "take_order")
	if !ok {
		return
	}
	itemID, ok := parseUintParam(c, "itemId")
	if !ok {
		return
	}
	order, err := ctrl.orderSvc.DeleteItem(restaurantID, orderID, itemID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "item.deleted", order)
}

func (ctrl *OrderController) SendToKitchen(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "take_order") {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	order, err := ctrl.orderSvc.SendToKitchen(restaurantID, userID, resolved.ID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "order.sent_to_kitchen", order)
}

func (ctrl *OrderController) UpdateItemStatus(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	itemID, ok := parseUintParam(c, "itemId")
	if !ok {
		return
	}
	var req service.StatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	// Serving and voiding at checkout are front-of-house steps, so take_order is
	// accepted for those transitions. Cooking/ready changes remain kitchen-only.
	status := strings.TrimSpace(req.Status)
	actor, ok := requireOrderItemStatusAccess(c, status)
	if !ok {
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	order, err := ctrl.orderSvc.UpdateItemStatus(restaurantID, userID, resolved.ID, itemID, status, req.Reason, actor)
	if err != nil {
		if errors.Is(err, service.ErrOrderItemStatusForbidden) {
			respondAPIError(c, http.StatusForbidden, err)
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "item.status_updated", order)
}

func (ctrl *OrderController) VoidItemUnits(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	itemID, ok := parseUintParam(c, "itemId")
	if !ok {
		return
	}
	var req service.VoidItemUnitsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	// Voiding is a front-of-house checkout step (take_order); kitchen managers
	// may also void. Reuse the same actor resolution as a "cancelled" status.
	actor, ok := requireOrderItemStatusAccess(c, entity.OrderItemStatusCancelled)
	if !ok {
		return
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return
	}
	order, err := ctrl.orderSvc.VoidItemUnits(restaurantID, userID, resolved.ID, itemID, req.Quantity, req.Reason, actor)
	if err != nil {
		if errors.Is(err, service.ErrOrderItemStatusForbidden) {
			respondAPIError(c, http.StatusForbidden, err)
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, order)
	ctrl.publishOrderChange(restaurantID, "item.status_updated", order)
}

func (ctrl *OrderController) KitchenQueue(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireOrderAccess(c, "view_kitchen") {
		return
	}
	orders, err := ctrl.orderSvc.KitchenQueue(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

func (ctrl *OrderController) OrderEvents(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(
		c,
		"missing order realtime permission",
		"view_orders",
		"take_order",
		"take_payment",
		"view_kitchen",
		"update_order_status",
	)
	if !ok {
		return
	}
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming is not supported"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	events, unsubscribe := ctrl.orderEvents.Subscribe(restaurantID)
	defer unsubscribe()
	heartbeatInterval := ctrl.eventHeartbeatInterval
	if heartbeatInterval <= 0 {
		heartbeatInterval = defaultOrderEventHeartbeatInterval
	}
	sessionLifetime := ctrl.eventSessionLifetime
	if sessionLifetime <= 0 {
		sessionLifetime = defaultOrderEventSessionLifetime
	}
	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()
	session := time.NewTimer(sessionLifetime)
	defer session.Stop()

	if _, err := fmt.Fprint(c.Writer, "retry: 3000\nevent: connected\ndata: {}\n\n"); err != nil {
		return
	}
	flusher.Flush()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-session.C:
			if _, err := fmt.Fprint(c.Writer, "event: reconnect\ndata: {\"reason\":\"revalidate\"}\n\n"); err != nil {
				return
			}
			flusher.Flush()
			return
		case event, open := <-events:
			if !open {
				return
			}
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (ctrl *OrderController) orderIDContext(c *gin.Context, permission string) (uint, uint, bool) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return 0, 0, false
	}
	if !requireOrderAccess(c, permission) {
		return 0, 0, false
	}
	resolved, ok := ctrl.resolveOrder(c, restaurantID)
	if !ok {
		return 0, 0, false
	}
	return restaurantID, resolved.ID, true
}
