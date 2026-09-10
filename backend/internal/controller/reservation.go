package controller

import (
	"net/http"
	"strconv"

	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReservationController struct {
	reservationSvc *service.ReservationService
	tableSvc       *service.TableService
}

func ProvideReservationController(db *gorm.DB) *ReservationController {
	return &ReservationController{
		reservationSvc: service.ProvideReservationService(repository.NewReservationRepository(db)),
		// Resolving a booking can free the table it holds, which is table-service
		// work; the route lives here because it is addressed by reservation id.
		tableSvc: service.ProvideTableService(repository.NewTableRepository(db)),
	}
}

// POST /api/v1/reservations/:id/resolve
func (ctrl *ReservationController) ResolveReservation(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing reservation permission", "manage_table", "take_order")
	if !ok {
		return
	}
	reservationID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	userID, _ := contextUserID(c)
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	reservation, err := ctrl.tableSvc.ResolveReservation(restaurantID, userID, reservationID, req.Status)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, reservation)
}

// GET /api/v1/reservations
func (ctrl *ReservationController) ListReservations(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing reservation permission", "manage_table", "view_tables", "take_order")
	if !ok {
		return
	}
	status := c.Query("status")
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	offset := 0
	if raw := c.Query("offset"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			offset = parsed
		}
	}
	result, err := ctrl.reservationSvc.ListReservations(restaurantID, status, limit, offset)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"reservations": result.Reservations,
		"has_more":     result.HasMore,
		"next_offset":  result.NextOffset,
		"counts":       result.Counts,
	})
}
