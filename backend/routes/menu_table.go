package routes

import (
	"time"

	"Project-M/config"
	"Project-M/internal/controller"

	"github.com/gin-gonic/gin"
)

func SetupMenuTableRoutes(v1 *gin.RouterGroup) {
	menuCtrl := controller.ProvideMenuController(config.DB())
	tableCtrl := controller.ProvideTableController(config.DB())
	reservationCtrl := controller.ProvideReservationController(config.DB())

	v1.GET("/categories", menuCtrl.ListCategories)
	v1.POST("/categories", menuCtrl.CreateCategory)
	v1.PUT("/categories/:id", menuCtrl.UpdateCategory)
	v1.DELETE("/categories/:id", menuCtrl.DeleteCategory)

	v1.GET("/menu-items", menuCtrl.ListMenuItems)
	v1.POST("/menu-items", menuCtrl.CreateMenuItem)
	v1.POST("/menu-items/preview-background", rateLimitRequests(30, time.Minute), menuCtrl.PreviewMenuImageBackground)
	v1.POST("/menu-items/upload-image", rateLimitRequests(30, time.Minute), menuCtrl.UploadMenuImage)
	v1.PUT("/menu-items/:id", menuCtrl.UpdateMenuItem)
	v1.PATCH("/menu-items/:id/availability", menuCtrl.UpdateMenuItemAvailability)
	v1.DELETE("/menu-items/:id", menuCtrl.DeleteMenuItem)

	v1.GET("/tables", tableCtrl.ListTables)
	v1.POST("/tables", tableCtrl.CreateTable)
	v1.POST("/tables/bulk-create", tableCtrl.BulkCreateTables)
	v1.POST("/tables/:id/regenerate-customer-token", tableCtrl.RegenerateCustomerToken)
	v1.PUT("/tables/:id", tableCtrl.UpdateTable)
	v1.PATCH("/tables/:id/status", tableCtrl.UpdateTableStatus)
	v1.POST("/tables/:id/reserve", tableCtrl.ReserveTable)
	v1.POST("/tables/:id/cancel-reservation", tableCtrl.CancelReservation)
	v1.POST("/tables/:id/seat-reservation", tableCtrl.SeatReservation)
	v1.PATCH("/tables/:id/move-zone", tableCtrl.MoveTableZone)
	v1.DELETE("/tables/:id", tableCtrl.DeleteTable)

	v1.GET("/reservations", reservationCtrl.ListReservations)
	v1.POST("/reservations/:id/resolve", reservationCtrl.ResolveReservation)

	v1.GET("/table-zones", tableCtrl.ListZones)
	v1.POST("/table-zones", tableCtrl.CreateZone)
	v1.PUT("/table-zones/:id", tableCtrl.UpdateZone)
	v1.DELETE("/table-zones/:id", tableCtrl.DeleteZone)

	v1.GET("/table-tags", tableCtrl.ListTags)
	v1.POST("/table-tags", tableCtrl.CreateTag)
	v1.PUT("/table-tags/:id", tableCtrl.UpdateTag)
	v1.DELETE("/table-tags/:id", tableCtrl.DeleteTag)
}
