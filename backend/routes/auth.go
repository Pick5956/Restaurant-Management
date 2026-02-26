package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"

	"github.com/gin-gonic/gin"
)

func SetupAuthRoutes(r *gin.RouterGroup) {
	userCtrl := controller.ProvideUserController(config.DB())
	r.POST("/login", userCtrl.Login)
	r.POST("/register", userCtrl.Register)
}
