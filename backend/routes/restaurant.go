package routes

import (
	"Project-M/config"
	"Project-M/internal/controller"
	"Project-M/internal/realtime"
	"time"

	"github.com/gin-gonic/gin"
)

// SetupRestaurantRoutes registers the multi-restaurant feature routes.
//   - public  : GET /api/invitations/:token (preview)
//   - private : everything under /api/v1/restaurants and /api/v1/invitations
//
// orderEvents carries order.repriced when a settings save changes the service
// charge or VAT that open orders are priced with.
func SetupRestaurantRoutes(api *gin.RouterGroup, v1 *gin.RouterGroup, orderEvents *realtime.OrderHub) {
	ctrl := controller.ProvideRestaurantController(config.DB(), orderEvents)

	// public preview — invitee can see invitation details before logging in
	api.GET("/invitations/:token", rateLimitRequests(60, time.Minute), ctrl.GetInvitationByToken)

	// private (require auth)
	v1.POST("/restaurants", ctrl.Create)
	v1.GET("/restaurants/me", ctrl.ListMyMemberships)
	v1.GET("/restaurants/slug-availability", rateLimitRequests(120, time.Minute), ctrl.SlugAvailability)
	v1.GET("/restaurants/:id", ctrl.Get)
	v1.PATCH("/restaurants/:id", ctrl.Update)
	v1.DELETE("/restaurants/:id", ctrl.Delete)
	v1.POST("/restaurants/:id/upload-logo", ctrl.UploadLogo)
	v1.POST("/restaurants/:id/upload-cover", ctrl.UploadCover)
	v1.POST("/restaurants/:id/upload-promptpay-qr", ctrl.UploadPromptPayQR)
	v1.GET("/restaurants/:id/members", ctrl.ListMembers)
	v1.PATCH("/restaurants/:id/members/:memberId/status", ctrl.UpdateMemberStatus)
	v1.PATCH("/restaurants/:id/members/:memberId/role", ctrl.UpdateMemberRole)
	v1.PATCH("/restaurants/:id/members/:memberId/permissions", ctrl.UpdateMemberPermissions)
	v1.GET("/restaurants/:id/audit-logs", ctrl.ListAuditLogs)

	v1.POST("/restaurants/:id/invitations", ctrl.CreateInvitation)
	v1.GET("/restaurants/:id/invitations", ctrl.ListPendingInvitations)
	v1.DELETE("/restaurants/:id/invitations/:invitationId", ctrl.RevokeInvitation)

	v1.POST("/invitations/:token/accept", rateLimitRequests(20, time.Minute), ctrl.AcceptInvitation)
}
