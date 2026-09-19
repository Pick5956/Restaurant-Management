package controller

import (
	"errors"
	"net/http"
	"strconv"

	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type IngredientController struct {
	svc *service.IngredientService
}

func ProvideIngredientController(db *gorm.DB) *IngredientController {
	return &IngredientController{
		svc: service.ProvideIngredientService(repository.NewIngredientRepository(db)),
	}
}

func (ctrl *IngredientController) List(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing inventory permission", "view_inventory", "manage_inventory")
	if !ok {
		return
	}
	// Pagination is opt-in: with no `limit` the full list is returned (the historical
	// behaviour), so a small inventory stays one fast request. `limit` caps at 200.
	limit := boundedQueryInt(c, "limit", 0, 0, 200)
	page := boundedQueryInt(c, "page", 1, 1, 1_000_000)
	query := repository.IngredientListQuery{
		Search: c.Query("search"),
		Status: c.Query("status"),
		Sort:   c.Query("sort"),
		Desc:   c.Query("order") == "desc",
		Limit:  limit,
	}
	if limit > 0 {
		query.Offset = (page - 1) * limit
	}
	items, total, err := ctrl.svc.ListFiltered(restaurantID, query)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ingredients": items, "total": total, "page": page, "limit": limit})
}

func (ctrl *IngredientController) ListCategories(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing inventory permission", "view_inventory", "manage_inventory")
	if !ok {
		return
	}
	items, err := ctrl.svc.ListCategories(restaurantID, memberCan(c, "manage_inventory"))
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": items})
}

func (ctrl *IngredientController) CreateCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	var req service.IngredientCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	category, err := ctrl.svc.CreateCategory(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, category)
}

func (ctrl *IngredientController) UpdateCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	categoryID, ok := parseUintParam(c, "categoryId")
	if !ok {
		return
	}
	var req service.IngredientCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	category, err := ctrl.svc.UpdateCategory(restaurantID, categoryID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, category)
}

func (ctrl *IngredientController) DeleteCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	categoryID, ok := parseUintParam(c, "categoryId")
	if !ok {
		return
	}
	if err := ctrl.svc.DeleteCategory(restaurantID, categoryID); err != nil {
		respondAPIError(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *IngredientController) Create(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	userID, ok := contextUserID(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid user context"})
		return
	}
	var req service.IngredientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	ingredient, err := ctrl.svc.Create(restaurantID, userID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, ingredient)
}

func (ctrl *IngredientController) Update(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.IngredientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	ingredient, err := ctrl.svc.Update(restaurantID, ingredientID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, ingredient)
}

func (ctrl *IngredientController) Delete(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.svc.Delete(restaurantID, ingredientID); err != nil {
		respondAPIError(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *IngredientController) AdjustStock(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.AdjustStockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	if !requireStockExpensePermission(c, req.Amount) {
		return
	}
	userID, _ := contextUserID(c)
	ingredient, err := ctrl.svc.AdjustStock(restaurantID, ingredientID, userID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, ingredient)
}

func (ctrl *IngredientController) ListLots(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing inventory permission", "view_inventory", "manage_inventory")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	lots, err := ctrl.svc.ListLots(restaurantID, ingredientID)
	if err != nil {
		respondAPIError(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"lots": lots})
}

type lotExpiryRequest struct {
	// Blank clears the date.
	ExpiresAt string `json:"expires_at" binding:"max=10"`
}

func (ctrl *IngredientController) UpdateLotExpiry(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	lotID, ok := parseUintParam(c, "lotId")
	if !ok {
		return
	}
	var req lotExpiryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	if err := ctrl.svc.UpdateLotExpiry(restaurantID, ingredientID, lotID, req.ExpiresAt); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type lotDiscardRequest struct {
	Reason string `json:"reason" binding:"max=200"`
}

func (ctrl *IngredientController) DiscardLot(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_inventory", "missing manage_inventory permission")
	if !ok {
		return
	}
	ingredientID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	lotID, ok := parseUintParam(c, "lotId")
	if !ok {
		return
	}
	var req lotDiscardRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		respondInvalidRequest(c)
		return
	}
	userID, _ := contextUserID(c)
	ingredient, err := ctrl.svc.DiscardLot(restaurantID, ingredientID, lotID, userID, req.Reason)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, ingredient)
}

func requireStockExpensePermission(c *gin.Context, amount float64) bool {
	if amount <= 0 {
		return true
	}
	return requirePermission(c, "manage_expenses", "missing manage_expenses permission")
}

// ListTransactions serves both the per-ingredient history (an :id in the path)
// and the whole-inventory one (no path id, filters on the query string). An id in
// the path wins over ingredient_id in the query string, so the per-item route can
// never be widened by a crafted URL.
func (ctrl *IngredientController) ListTransactions(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing inventory permission", "view_inventory", "manage_inventory")
	if !ok {
		return
	}
	query, err := parseIngredientTransactionQuery(c)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	if raw := c.Param("id"); raw != "" && raw != "/" {
		id, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr != nil {
			respondAPIError(c, http.StatusBadRequest, errors.New("ingredient id must be a number"))
			return
		}
		query.IngredientID = uint(id)
	}
	limit := boundedQueryInt(c, "limit", 100, 1, 200)
	page := boundedQueryInt(c, "page", 1, 1, 1_000_000)
	query.Limit = limit
	query.Offset = (page - 1) * limit

	txs, total, err := ctrl.svc.ListTransactions(restaurantID, query)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transactions": txs, "total": total, "page": page, "limit": limit})
}
