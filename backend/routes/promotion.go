package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"
	"Project-M/internal/realtime"

	"github.com/gin-gonic/gin"
)

func SetupPromotionRoutes(v1 *gin.RouterGroup, orderEvents *realtime.OrderHub) {
	ctrl := controller.ProvidePromotionController(config.DB(), orderEvents)

	v1.GET("/promotions", ctrl.List)
	v1.POST("/promotions", ctrl.Create)
	v1.PUT("/promotions/:id", ctrl.Update)
	v1.PATCH("/promotions/:id/active", ctrl.SetActive)
	v1.DELETE("/promotions/:id", ctrl.Delete)
}
