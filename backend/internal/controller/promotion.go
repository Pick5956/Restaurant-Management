package controller

import (
	"net/http"

	"Project-M/internal/realtime"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// orderRepricedAction tells every till that an order's price moved because a
// promotion or the restaurant's service charge/VAT changed, not because anyone
// touched the order.
const orderRepricedAction = "order.repriced"

type PromotionController struct {
	svc         *service.PromotionService
	orderEvents *realtime.OrderHub
}

func ProvidePromotionController(db *gorm.DB, orderEvents *realtime.OrderHub) *PromotionController {
	return &PromotionController{
		svc: service.ProvidePromotionService(
			repository.NewPromotionRepository(db),
			repository.NewOrderRepository(db),
		),
		orderEvents: orderEvents,
	}
}

func (ctrl *PromotionController) publishRepriced(restaurantID uint, orderIDs []uint) {
	publishOrdersRepriced(ctrl.orderEvents, restaurantID, orderIDs)
}

// publishOrdersRepriced tells every till which orders a price change moved,
// whether it came from a promotion or from the restaurant's bill settings.
func publishOrdersRepriced(orderEvents *realtime.OrderHub, restaurantID uint, orderIDs []uint) {
	if orderEvents == nil {
		return
	}
	for _, orderID := range orderIDs {
		orderEvents.Publish(restaurantID, orderRepricedAction, orderID)
	}
}

func (ctrl *PromotionController) List(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_promotions", "missing manage_promotions permission")
	if !ok {
		return
	}
	promotions, err := ctrl.svc.List(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"promotions": promotions})
}

func (ctrl *PromotionController) Create(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_promotions", "missing manage_promotions permission")
	if !ok {
		return
	}
	var req service.PromotionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.Create(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"promotion": result.Promotion})
	ctrl.publishRepriced(restaurantID, result.RepricedOrders)
}

func (ctrl *PromotionController) Update(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_promotions", "missing manage_promotions permission")
	if !ok {
		return
	}
	promotionID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.PromotionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.Update(restaurantID, promotionID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"promotion": result.Promotion})
	ctrl.publishRepriced(restaurantID, result.RepricedOrders)
}

type promotionActiveRequest struct {
	IsActive *bool `json:"is_active" binding:"required"`
}

func (ctrl *PromotionController) SetActive(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_promotions", "missing manage_promotions permission")
	if !ok {
		return
	}
	promotionID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req promotionActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.SetActive(restaurantID, promotionID, *req.IsActive)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"promotion": result.Promotion})
	ctrl.publishRepriced(restaurantID, result.RepricedOrders)
}

func (ctrl *PromotionController) Delete(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_promotions", "missing manage_promotions permission")
	if !ok {
		return
	}
	promotionID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	repriced, err := ctrl.svc.Delete(restaurantID, promotionID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
	ctrl.publishRepriced(restaurantID, repriced)
}
