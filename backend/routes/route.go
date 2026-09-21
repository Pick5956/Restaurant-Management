package routes

import (
	"Project-M/config"
	"Project-M/internal/auth"
	"Project-M/internal/controller"
	"Project-M/internal/realtime"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine) {
	orderEvents := realtime.NewOrderHub()
	api := r.Group("/api")
	SetupAuthRoutes(api)
	SetupCustomerOrderRoutes(api, orderEvents)

	userCtrl := controller.ProvideUserController(config.DB())
	roleCtrl := controller.ProvideRoleController(config.DB())

	v1 := api.Group("v1")
	v1.Use(auth.Authorizes(config.DB()))
	v1.Use(auth.RestaurantScope(config.DB()))
	{
		v1.GET("/users/profile", userCtrl.GetProfile)
		v1.PATCH("/users/profile", userCtrl.UpdateProfile)
		v1.POST("/users/profile/upload-image", userCtrl.UploadProfileImage)
		v1.GET("/roles", roleCtrl.GetScopedRoles)
		v1.POST("/roles", roleCtrl.CreateCustomRole)
		v1.PATCH("/roles/:roleId", roleCtrl.UpdateRoleDisplayName)
		v1.DELETE("/roles/:roleId", roleCtrl.DeleteCustomRole)
		v1.PATCH("/roles/:roleId/permissions", roleCtrl.UpdateRolePermissions)
	}

	// Restaurants + invitations.
	// `api` carries the public invitation preview route, `v1` carries everything that requires auth.
	SetupRestaurantRoutes(api, v1)
	SetupMenuTableRoutes(v1)
	SetupIngredientRoutes(v1)
	SetupExpenseRoutes(v1)
	SetupOrderRoutes(v1, orderEvents)
	SetupPromotionRoutes(v1, orderEvents)
	SetupReportRoutes(v1)
	SetupAIRoutes(v1)
}
