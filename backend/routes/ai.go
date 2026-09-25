package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"
	"time"

	"github.com/gin-gonic/gin"
)

func SetupAIRoutes(v1 *gin.RouterGroup) {
	aiCtrl := controller.ProvideAIController(config.DB())

	v1.GET("/ai/operations/snapshot", rateLimitRequests(60, time.Minute), aiCtrl.OperationsSnapshot)
	v1.GET("/ai/operations/metrics", rateLimitRequests(30, time.Minute), aiCtrl.UsageMetrics)
	v1.GET("/ai/operations/insights", rateLimitRequests(60, time.Minute), aiCtrl.ProactiveInsights)
	v1.POST("/ai/operations/plans/:planID/confirm", rateLimitRequests(30, time.Minute), aiCtrl.ConfirmAIActionPlan)
	v1.DELETE("/ai/operations/plans/:planID", rateLimitRequests(30, time.Minute), aiCtrl.CancelAIActionPlan)
	v1.POST("/ai/operations/plans/:planID/items/:seq/ingredient", rateLimitRequests(60, time.Minute), aiCtrl.SetupAIPlanIngredient)
	v1.GET("/ai/operations/settings", rateLimitRequests(60, time.Minute), aiCtrl.GetAISettings)
	v1.PUT("/ai/operations/settings", rateLimitRequests(30, time.Minute), aiCtrl.UpdateAISettings)
	v1.POST("/ai/operations/ask", rateLimitRequests(20, time.Minute), aiCtrl.AskOperations)
	v1.POST("/ai/operations/receipt", rateLimitRequests(15, time.Minute), aiCtrl.ExtractReceipt)
	v1.POST("/ai/operations/transcribe", rateLimitRequests(30, time.Minute), aiCtrl.Transcribe)
	v1.POST("/ai/operations/actions/:previewID/confirm", rateLimitRequests(10, time.Minute), aiCtrl.ConfirmAction)
	v1.DELETE("/ai/operations/actions/:previewID", rateLimitRequests(10, time.Minute), aiCtrl.CancelAction)
	// The chat list. DELETE on a chat moves it to the trash; "permanent" and
	// "purge" are the trash's own buttons.
	v1.GET("/ai/operations/conversations", rateLimitRequests(60, time.Minute), aiCtrl.ListConversations)
	v1.GET("/ai/operations/conversations/:conversationID/turns", rateLimitRequests(60, time.Minute), aiCtrl.ConversationTurns)
	v1.PATCH("/ai/operations/conversations/:conversationID", rateLimitRequests(30, time.Minute), aiCtrl.RenameConversation)
	v1.POST("/ai/operations/conversations/:conversationID/restore", rateLimitRequests(30, time.Minute), aiCtrl.RestoreConversation)
	v1.DELETE("/ai/operations/conversations/:conversationID/permanent", rateLimitRequests(10, time.Minute), aiCtrl.PurgeConversation)
	v1.POST("/ai/operations/conversations/purge", rateLimitRequests(5, time.Minute), aiCtrl.PurgeAllTrashed)
	v1.DELETE("/ai/operations/conversations/:conversationID", rateLimitRequests(20, time.Minute), aiCtrl.DeleteConversation)
	v1.DELETE("/ai/operations/conversations", rateLimitRequests(5, time.Minute), aiCtrl.DeleteAllConversations)
}
