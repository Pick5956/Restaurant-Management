package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"

	"github.com/gin-gonic/gin"
)

func SetupIngredientRoutes(v1 *gin.RouterGroup) {
	ingredientCtrl := controller.ProvideIngredientController(config.DB())

	v1.GET("/ingredient-categories", ingredientCtrl.ListCategories)
	v1.POST("/ingredient-categories", ingredientCtrl.CreateCategory)
	v1.PUT("/ingredient-categories/:categoryId", ingredientCtrl.UpdateCategory)
	v1.DELETE("/ingredient-categories/:categoryId", ingredientCtrl.DeleteCategory)
	v1.GET("/ingredients", ingredientCtrl.List)
	v1.POST("/ingredients", ingredientCtrl.Create)
	v1.PUT("/ingredients/:id", ingredientCtrl.Update)
	v1.DELETE("/ingredients/:id", ingredientCtrl.Delete)
	v1.POST("/ingredients/:id/adjust", ingredientCtrl.AdjustStock)
	v1.GET("/ingredients/:id/transactions", ingredientCtrl.ListTransactions)
	// Lots: one per delivery, the only place an expiry date lives.
	v1.GET("/ingredients/:id/lots", ingredientCtrl.ListLots)
	v1.PUT("/ingredients/:id/lots/:lotId", ingredientCtrl.UpdateLotExpiry)
	v1.POST("/ingredients/:id/lots/:lotId/discard", ingredientCtrl.DiscardLot)

	// The whole-inventory history and the CSV exports sit on their own paths
	// rather than under /ingredients, so gin never has to choose between a static
	// segment and the :id wildcard at the same position.
	v1.GET("/ingredient-transactions", ingredientCtrl.ListTransactions)
	v1.GET("/ingredient-transactions/export", ingredientCtrl.ExportTransactionsCSV)
	v1.GET("/ingredient-stock/export", ingredientCtrl.ExportStockCSV)
}
