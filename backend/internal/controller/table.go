package controller

import (
	"net/http"
	"strings"
	"time"

	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TableController struct {
	tableSvc *service.TableService
}

func ProvideTableController(db *gorm.DB) *TableController {
	return &TableController{
		tableSvc: service.ProvideTableService(repository.NewTableRepository(db)),
	}
}

func (ctrl *TableController) ListTables(c *gin.Context) {
	// take_order is included so the order-taking floor can load the table list
	// without granting view_tables (which also gates the Tables management page).
	// Consistent with UpdateTableStatus, which already accepts take_order.
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table permission", "view_tables", "manage_table", "take_order")
	if !ok {
		return
	}
	tables, err := ctrl.tableSvc.ListTables(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tables": tables})
}

func (ctrl *TableController) CreateTable(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	var req service.TableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	table, err := ctrl.tableSvc.CreateTable(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, table)
}

func (ctrl *TableController) BulkCreateTables(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	var req service.BulkCreateTablesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	tables, err := ctrl.tableSvc.BulkCreateTables(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"tables": tables})
}

func (ctrl *TableController) UpdateTable(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.TableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	table, err := ctrl.tableSvc.UpdateTable(restaurantID, tableID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

func (ctrl *TableController) UpdateTableStatus(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table status permission", "manage_table", "take_order")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		ReservationName  string `json:"reservation_name"`
		Status           string `json:"status" binding:"required"`
		ReservationPhone string `json:"reservation_phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	if !memberCan(c, "manage_table") && req.Status != "free" && req.Status != "reserved" {
		c.JSON(http.StatusForbidden, gin.H{"error": "take_order can only mark tables free or reserved"})
		return
	}
	userID, _ := contextUserID(c)
	table, err := ctrl.tableSvc.UpdateTableStatus(restaurantID, userID, tableID, req.Status, req.ReservationPhone, req.ReservationName)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

// POST /api/v1/tables/:id/reserve
func (ctrl *TableController) ReserveTable(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table status permission", "manage_table", "take_order")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	userID, _ := contextUserID(c)
	var req struct {
		ReservationName  string `json:"reservation_name"`
		ReservationPhone string `json:"reservation_phone"`
		// Omitted or empty means "hold the table now". Sent means a booking for
		// that time, which leaves the table sellable until the guests arrive.
		ReservedFor string `json:"reserved_for"`
		GuestCount  int    `json:"guest_count"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	var reservedFor *time.Time
	if trimmed := strings.TrimSpace(req.ReservedFor); trimmed != "" {
		parsed, err := time.Parse(time.RFC3339, trimmed)
		if err != nil {
			respondInvalidRequest(c)
			return
		}
		reservedFor = &parsed
	}
	table, err := ctrl.tableSvc.ReserveTable(restaurantID, userID, tableID, req.ReservationPhone, req.ReservationName, req.GuestCount, reservedFor)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

// POST /api/v1/tables/:id/cancel-reservation
func (ctrl *TableController) CancelReservation(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table status permission", "manage_table", "take_order")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	userID, _ := contextUserID(c)
	table, err := ctrl.tableSvc.CancelReservation(restaurantID, userID, tableID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

// POST /api/v1/tables/:id/seat-reservation
func (ctrl *TableController) SeatReservation(c *gin.Context) {
	_, ok := requireRestaurantWithAnyPermission(c, "missing table status permission", "manage_table", "take_order")
	if !ok {
		return
	}
	if _, ok := parseUintParam(c, "id"); !ok {
		return
	}
	c.JSON(http.StatusGone, gin.H{
		"code":  "legacy_seat_reservation_retired",
		"error": "seat reservations by opening an order with seat_reservation enabled",
	})
}

func (ctrl *TableController) RegenerateCustomerToken(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	table, err := ctrl.tableSvc.RegenerateCustomerToken(restaurantID, tableID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

func (ctrl *TableController) MoveTableZone(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.MoveTableZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	table, err := ctrl.tableSvc.MoveTableZone(restaurantID, tableID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, table)
}

func (ctrl *TableController) DeleteTable(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tableID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.tableSvc.DeleteTable(restaurantID, tableID); err != nil {
		respondAPIError(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *TableController) ListZones(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table permission", "view_tables", "manage_table")
	if !ok {
		return
	}
	zones, err := ctrl.tableSvc.ListZones(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"zones": zones})
}

func (ctrl *TableController) CreateZone(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	var req service.TableZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	zone, err := ctrl.tableSvc.CreateZone(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, zone)
}

func (ctrl *TableController) UpdateZone(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	zoneID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.TableZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	zone, err := ctrl.tableSvc.UpdateZone(restaurantID, zoneID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, zone)
}

func (ctrl *TableController) DeleteZone(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	zoneID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.tableSvc.DeleteZone(restaurantID, zoneID); err != nil {
		respondAPIError(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *TableController) ListTags(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing table permission", "view_tables", "manage_table")
	if !ok {
		return
	}
	tags, err := ctrl.tableSvc.ListTags(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": tags})
}

func (ctrl *TableController) CreateTag(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	var req service.TableTagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	tag, err := ctrl.tableSvc.CreateTag(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, tag)
}

func (ctrl *TableController) UpdateTag(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tagID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.TableTagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	tag, err := ctrl.tableSvc.UpdateTag(restaurantID, tagID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, tag)
}

func (ctrl *TableController) DeleteTag(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_table", "missing manage_table permission")
	if !ok {
		return
	}
	tagID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.tableSvc.DeleteTag(restaurantID, tagID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
