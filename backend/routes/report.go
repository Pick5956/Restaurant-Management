package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"

	"github.com/gin-gonic/gin"
)

func SetupReportRoutes(v1 *gin.RouterGroup) {
	ctrl := controller.ProvideReportController(config.DB())

	v1.GET("/reports/manager", ctrl.ManagerReport)
	v1.GET("/reports/sales-by-hour", ctrl.SalesByHour)
	v1.GET("/reports/sales-detail", ctrl.SalesDetail)
	v1.GET("/reports/top-menu-items", ctrl.TopMenuItemsByMonth)
}
