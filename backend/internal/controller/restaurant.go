package controller

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/realtime"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RestaurantController struct {
	restaurantSvc *service.RestaurantService
	invitationSvc *service.InvitationService
	// An open order stores its service charge and VAT, so a settings save that
	// changes them reprices the open orders and announces it.
	orders      *repository.OrderRepository
	orderEvents *realtime.OrderHub
}

func ProvideRestaurantController(db *gorm.DB, orderEvents *realtime.OrderHub) *RestaurantController {
	restaurantRepo := repository.NewRestaurantRepository(db)
	memberRepo := repository.NewRestaurantMemberRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	invRepo := repository.NewInvitationRepository(db)
	userRepo := repository.NewUserRepository(db)
	auditRepo := repository.NewRestaurantAuditLogRepository(db)
	setupRepo := repository.NewRestaurantSetupRepository(db)

	return &RestaurantController{
		restaurantSvc: service.ProvideRestaurantService(restaurantRepo, memberRepo, roleRepo, auditRepo, setupRepo),
		invitationSvc: service.ProvideInvitationService(invRepo, memberRepo, roleRepo, userRepo, auditRepo),
		orders:        repository.NewOrderRepository(db),
		orderEvents:   orderEvents,
	}
}

type updateMemberStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

type updateMemberRoleRequest struct {
	RoleID uint `json:"role_id" binding:"required"`
}

type updateMemberPermissionsRequest struct {
	UseRolePermissions bool     `json:"use_role_permissions"`
	Permissions        []string `json:"permissions"`
}

func contextUserID(c *gin.Context) (uint, bool) {
	v, ok := c.Get("user_id")
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case uint:
		return n, true
	case float64:
		return uint(n), true
	default:
		return 0, false
	}
}

func parseIDParam(c *gin.Context, key string) (uint, error) {
	raw := c.Param(key)
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, errors.New("invalid id")
	}
	return uint(v), nil
}

func requireScopedRestaurantParam(c *gin.Context, key string) (uint, bool) {
	scopedRestaurantID, ok := requireRestaurant(c)
	if !ok {
		return 0, false
	}
	pathRestaurantID, err := parseIDParam(c, key)
	if err != nil || pathRestaurantID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid restaurant id"})
		return 0, false
	}
	if pathRestaurantID != scopedRestaurantID {
		c.JSON(http.StatusForbidden, gin.H{"error": "restaurant path does not match restaurant context"})
		return 0, false
	}
	return scopedRestaurantID, true
}

// POST /api/v1/restaurants
func (ctrl *RestaurantController) Create(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req service.CreateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	restaurant, member, err := ctrl.restaurantSvc.CreateRestaurant(userID, &req)
	if err != nil {
		if respondRestaurantSlugError(c, err) {
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"restaurant": restaurant,
		"membership": service.NewMembershipResponse(member),
	})
}

// GET /api/v1/restaurants/me
func (ctrl *RestaurantController) ListMyMemberships(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	memberships, err := ctrl.restaurantSvc.ListMyMemberships(userID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"memberships": service.NewMembershipResponses(memberships)})
}

// GET /api/v1/restaurants/slug-availability?slug=krua-pick&restaurant_id=12
//
// Lets the onboarding and settings forms say "taken" while the owner types.
// restaurant_id is the restaurant being edited, so its own slug reads as
// available; it is honoured only for a member of that restaurant.
func (ctrl *RestaurantController) SlugAvailability(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var excludeID uint
	if raw := strings.TrimSpace(c.Query("restaurant_id")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || parsed == 0 {
			respondInvalidRequest(c)
			return
		}
		if _, err := ctrl.restaurantSvc.GetMembership(userID, uint(parsed)); err == nil {
			excludeID = uint(parsed)
		}
	}

	availability, err := ctrl.restaurantSvc.CheckSlugAvailability(c.Query("slug"), excludeID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, availability)
}

// respondRestaurantSlugError answers the two slug failures with a code the
// forms can branch on, and reports whether it did.
func respondRestaurantSlugError(c *gin.Context, err error) bool {
	switch {
	case errors.Is(err, service.ErrRestaurantSlugTaken):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "slug_taken"})
		return true
	case errors.Is(err, service.ErrRestaurantSlugInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "slug_invalid"})
		return true
	}
	return false
}

// GET /api/v1/restaurants/:id
func (ctrl *RestaurantController) Get(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, err := parseIDParam(c, "id")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	if _, err := ctrl.restaurantSvc.GetMembership(userID, restaurantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this restaurant"})
		return
	}

	restaurant, err := ctrl.restaurantSvc.GetRestaurant(restaurantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "restaurant not found"})
		return
	}
	c.JSON(http.StatusOK, restaurant)
}

// PATCH /api/v1/restaurants/:id
func (ctrl *RestaurantController) Update(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, err := parseIDParam(c, "id")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	member, err := ctrl.restaurantSvc.GetMembership(userID, restaurantID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this restaurant"})
		return
	}
	if !service.MemberHasPermission(member, service.PermissionManageRestaurantSettings) {
		c.JSON(http.StatusForbidden, gin.H{"error": "missing manage_restaurant_settings permission"})
		return
	}

	var req service.UpdateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	// Read before the save, to tell whether the bill settings moved.
	previous, previousErr := ctrl.restaurantSvc.GetRestaurant(restaurantID)

	restaurant, err := ctrl.restaurantSvc.UpdateRestaurant(restaurantID, &req)
	if err != nil {
		if respondRestaurantSlugError(c, err) {
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	// Priced before answering, so a till that reloads on the reply already
	// reads the new totals. Unknown previous settings reprice too: an order
	// whose money did not move is neither saved nor announced.
	if ctrl.orders != nil && (previousErr != nil || service.BillChargesChanged(previous, restaurant)) {
		repriced := service.RepriceOpenOrders(ctrl.orders, restaurantID, "bill_settings")
		publishOrdersRepriced(ctrl.orderEvents, restaurantID, repriced)
	}

	c.JSON(http.StatusOK, gin.H{"restaurant": restaurant})
}

// uploadRestaurantImage is the single path behind upload-logo, upload-cover and
// upload-promptpay-qr.
//
// They used to be three copies of the same seventy lines, and the copies had
// drifted: the PromptPay QR one — the endpoint that stores the image customers
// scan to pay — had lost the tenant quota check, the cleanup of the file it had
// just written when the database write failed, the removal of the image it
// replaced, and respondAPIError, so it answered a failed update with the raw
// driver error. One shared body is what stops that happening again; a protection
// added here cannot be missing from one of the three.
func (ctrl *RestaurantController) uploadRestaurantImage(
	c *gin.Context,
	previousImage func(*entity.Restaurant) string,
	update func(restaurantID uint, publicPath string) (*entity.Restaurant, error),
) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, err := parseIDParam(c, "id")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	member, err := ctrl.restaurantSvc.GetMembership(userID, restaurantID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this restaurant"})
		return
	}
	if !service.MemberHasPermission(member, service.PermissionManageRestaurantSettings) {
		c.JSON(http.StatusForbidden, gin.H{"error": "missing manage_restaurant_settings permission"})
		return
	}
	existingRestaurant, err := ctrl.restaurantSvc.GetRestaurant(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusNotFound, err)
		return
	}

	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "image file is required"})
		return
	}
	ext, err := validateImageUpload(file)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate filename"})
		return
	}
	fileName := hex.EncodeToString(random) + ext
	tenant := strconv.FormatUint(uint64(restaurantID), 10)
	relativeDir := filepath.Join("uploads", "restaurants", tenant)
	// All three images share this directory, so an unmetered one would spend the
	// budget the other two are checked against.
	if err := ensureUploadQuota(relativeDir, file.Size, maxTenantImageFiles, maxTenantImageBytes); err != nil {
		respondAPIError(c, http.StatusInsufficientStorage, err)
		return
	}
	if err := os.MkdirAll(relativeDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare upload folder"})
		return
	}
	destination := filepath.Join(relativeDir, fileName)
	if err := c.SaveUploadedFile(file, destination); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save image"})
		return
	}

	publicPrefix := "/uploads/restaurants/" + tenant + "/"
	restaurant, err := update(restaurantID, publicURL(c, publicPrefix+fileName))
	if err != nil {
		removeSavedUpload(destination)
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	removeReplacedUpload(previousImage(existingRestaurant), publicPrefix, destination)

	c.JSON(http.StatusCreated, gin.H{"restaurant": restaurant})
}

// POST /api/v1/restaurants/:id/upload-logo
func (ctrl *RestaurantController) UploadLogo(c *gin.Context) {
	ctrl.uploadRestaurantImage(c,
		func(r *entity.Restaurant) string { return r.Logo },
		ctrl.restaurantSvc.UpdateRestaurantLogo)
}

// POST /api/v1/restaurants/:id/upload-cover
func (ctrl *RestaurantController) UploadCover(c *gin.Context) {
	ctrl.uploadRestaurantImage(c,
		func(r *entity.Restaurant) string { return r.CoverImage },
		ctrl.restaurantSvc.UpdateRestaurantCover)
}

// POST /api/v1/restaurants/:id/upload-promptpay-qr
func (ctrl *RestaurantController) UploadPromptPayQR(c *gin.Context) {
	ctrl.uploadRestaurantImage(c,
		func(r *entity.Restaurant) string { return r.PromptPayQRImage },
		ctrl.restaurantSvc.UpdateRestaurantPromptPayQR)
}

// GET /api/v1/restaurants/:id/members
func (ctrl *RestaurantController) ListMembers(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requireAnyPermission(
		c,
		"missing team management permission",
		service.PermissionManageInvites,
		service.PermissionManageMembers,
		service.PermissionManageRoles,
		service.PermissionViewAuditLog,
	) {
		return
	}
	members, err := ctrl.restaurantSvc.ListMembersForActor(userID, restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"members": service.NewMembershipResponses(members)})
}

// PATCH /api/v1/restaurants/:id/members/:memberId/status
func (ctrl *RestaurantController) UpdateMemberStatus(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageMembers, "missing manage_members permission") {
		return
	}
	memberID, err := parseIDParam(c, "memberId")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	var req updateMemberStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	member, err := ctrl.restaurantSvc.UpdateMemberStatus(userID, restaurantID, memberID, req.Status)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"member": service.NewMembershipResponse(member)})
}

// PATCH /api/v1/restaurants/:id/members/:memberId/role
func (ctrl *RestaurantController) UpdateMemberRole(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageRoles, "missing manage_roles permission") {
		return
	}
	memberID, err := parseIDParam(c, "memberId")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	var req updateMemberRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	member, err := ctrl.restaurantSvc.UpdateMemberRole(userID, restaurantID, memberID, req.RoleID)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"member": service.NewMembershipResponse(member)})
}

// PATCH /api/v1/restaurants/:id/members/:memberId/permissions
func (ctrl *RestaurantController) UpdateMemberPermissions(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageRoles, "missing manage_roles permission") {
		return
	}
	memberID, err := parseIDParam(c, "memberId")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	var req updateMemberPermissionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	var permissionsOverride *([]string)
	if !req.UseRolePermissions {
		permissionsOverride = &req.Permissions
	}
	member, err := ctrl.restaurantSvc.UpdateMemberPermissions(userID, restaurantID, memberID, permissionsOverride)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"member": service.NewMembershipResponse(member)})
}

// GET /api/v1/restaurants/:id/audit-logs
func (ctrl *RestaurantController) ListAuditLogs(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionViewAuditLog, "missing view_audit_log permission") {
		return
	}

	limit := 20
	if raw := c.Query("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 50 {
			limit = parsed
		}
	}
	offset := 0
	if raw := c.Query("offset"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			offset = parsed
		}
	}

	logs, err := ctrl.restaurantSvc.ListAuditLogs(userID, restaurantID, limit+1, offset)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	hasMore := len(logs) > limit
	if hasMore {
		logs = logs[:limit]
	}
	c.JSON(http.StatusOK, gin.H{
		"logs":        logs,
		"has_more":    hasMore,
		"next_offset": offset + len(logs),
	})
}

// POST /api/v1/restaurants/:id/invitations
func (ctrl *RestaurantController) CreateInvitation(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageInvites, "missing manage_invites permission") {
		return
	}

	var req service.CreateInvitationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}

	inv, err := ctrl.invitationSvc.CreateInvitation(restaurantID, userID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, service.NewAdminInvitationResponse(inv))
}

// GET /api/v1/restaurants/:id/invitations
func (ctrl *RestaurantController) ListPendingInvitations(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageInvites, "missing manage_invites permission") {
		return
	}

	invs, err := ctrl.invitationSvc.ListPending(userID, restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"invitations": service.NewAdminInvitationResponses(invs)})
}

// DELETE /api/v1/restaurants/:id/invitations/:invitationId
func (ctrl *RestaurantController) RevokeInvitation(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, ok := requireScopedRestaurantParam(c, "id")
	if !ok {
		return
	}
	if !requirePermission(c, service.PermissionManageInvites, "missing manage_invites permission") {
		return
	}
	invitationID, err := parseIDParam(c, "invitationId")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	if err := ctrl.invitationSvc.RevokeInvitation(userID, restaurantID, invitationID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "revoked"})
}

// GET /api/invitations/:token  (public — show invitation preview)
func (ctrl *RestaurantController) GetInvitationByToken(c *gin.Context) {
	token := c.Param("token")
	inv, err := ctrl.invitationSvc.GetByToken(token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invitation not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"invitation": service.NewPublicInvitationResponse(inv),
		"usable":     inv.IsUsable(),
	})
}

// POST /api/v1/invitations/:token/accept
func (ctrl *RestaurantController) AcceptInvitation(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	token := c.Param("token")
	member, err := ctrl.invitationSvc.AcceptInvitation(userID, token)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"membership": service.NewMembershipResponse(member)})
}

// DELETE /api/v1/restaurants/:id
func (ctrl *RestaurantController) Delete(c *gin.Context) {
	userID, ok := contextUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	restaurantID, err := parseIDParam(c, "id")
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}

	member, err := ctrl.restaurantSvc.GetMembership(userID, restaurantID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this restaurant"})
		return
	}
	if member.Role == nil || member.Role.Name != "owner" {
		c.JSON(http.StatusForbidden, gin.H{"error": "only owner can delete the restaurant"})
		return
	}

	if err := ctrl.restaurantSvc.DeleteRestaurant(restaurantID); err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
