package controller

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/media"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MenuController struct {
	menuSvc *service.MenuService
}

const defaultMenuBackgroundStrength = 50

var (
	errInvalidRemoveBackground   = errors.New("remove_background must be true or false")
	errInvalidBackgroundStrength = errors.New("background_strength must be between 0 and 100")
	errBackgroundNotDetected     = errors.New("a removable background was not detected")
	errProcessedImageTooLarge    = errors.New("processed image exceeds the 5MB upload limit")
)

func ProvideMenuController(db *gorm.DB) *MenuController {
	return &MenuController{
		menuSvc: service.ProvideMenuService(repository.NewMenuRepository(db)),
	}
}

func contextRestaurantID(c *gin.Context) (uint, bool) {
	v, ok := c.Get("restaurant_id")
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

func contextMember(c *gin.Context) (*entity.RestaurantMember, bool) {
	v, ok := c.Get("restaurant_member")
	if !ok {
		return nil, false
	}
	member, ok := v.(*entity.RestaurantMember)
	return member, ok
}

func memberCan(c *gin.Context, permission string) bool {
	member, ok := contextMember(c)
	if !ok || member.Role == nil {
		return false
	}
	if service.MemberHasPermission(member, permission) {
		return true
	}
	if member.PermissionsOverride != nil {
		return false
	}
	if member.Role.Permissions != "" {
		return false
	}
	role := member.Role.Name
	if permission == "view_menu" {
		return role == "owner" || role == "manager" || role == "waiter" || role == "chef"
	}
	if permission == "manage_menu" {
		return role == "owner" || role == "manager"
	}
	if permission == "manage_promotions" {
		return role == "owner" || role == "manager"
	}
	if permission == "view_tables" {
		return role == "owner" || role == "manager" || role == "cashier" || role == "waiter"
	}
	if permission == "manage_table" {
		return role == "owner" || role == "manager"
	}
	if permission == "take_order" {
		return role == "owner" || role == "manager" || role == "waiter"
	}
	if permission == "view_orders" {
		return role == "owner" || role == "manager" || role == "cashier" || role == "waiter"
	}
	if permission == "view_kitchen" {
		return role == "owner" || role == "manager" || role == "chef"
	}
	if permission == "update_order_status" {
		return role == "owner" || role == "manager" || role == "chef"
	}
	if permission == "take_payment" {
		return role == "owner" || role == "manager" || role == "cashier" || role == "waiter"
	}
	if permission == "manage_inventory" {
		return role == "owner" || role == "manager"
	}
	if permission == "manage_expenses" {
		return role == "owner" || role == "manager"
	}
	if permission == "view_inventory" {
		return role == "owner" || role == "manager" || role == "chef"
	}
	if permission == "view_reports" {
		return role == "owner" || role == "manager"
	}
	return false
}

func memberCanAny(c *gin.Context, permissions ...string) bool {
	for _, permission := range permissions {
		if memberCan(c, permission) {
			return true
		}
	}
	return false
}

func requireRestaurant(c *gin.Context) (uint, bool) {
	restaurantID, ok := contextRestaurantID(c)
	if !ok || restaurantID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "restaurant context is required"})
		return 0, false
	}
	return restaurantID, true
}

func parseUintParam(c *gin.Context, key string) (uint, bool) {
	raw := c.Param(key)
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return 0, false
	}
	return uint(id), true
}

// A promotion names dishes and categories, so whoever sets promotions reads
// the whole menu - sold-out dishes and hidden categories included - the same
// way whoever manages the menu does.
func (ctrl *MenuController) ListCategories(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing menu permission", "view_menu", "manage_menu", "take_order", "manage_promotions")
	if !ok {
		return
	}
	categories, err := ctrl.menuSvc.ListCategories(restaurantID, memberCanAny(c, "manage_menu", "manage_promotions"))
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func (ctrl *MenuController) CreateCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	var req service.CategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	category, err := ctrl.menuSvc.CreateCategory(restaurantID, &req)
	if err != nil {
		// Keep the explicit payload: the menu page matches on this exact code.
		if errors.Is(err, service.ErrCategoryNameExists) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "CATEGORY_NAME_EXISTS"})
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, category)
}

func (ctrl *MenuController) UpdateCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	categoryID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.CategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	category, err := ctrl.menuSvc.UpdateCategory(restaurantID, categoryID, &req)
	if err != nil {
		// Keep the explicit payload: the menu page matches on this exact code.
		if errors.Is(err, service.ErrCategoryNameExists) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "CATEGORY_NAME_EXISTS"})
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, category)
}

func (ctrl *MenuController) DeleteCategory(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	categoryID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.menuSvc.DeleteCategory(restaurantID, categoryID); err != nil {
		respondAPIError(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *MenuController) ListMenuItems(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithAnyPermission(c, "missing menu permission", "view_menu", "manage_menu", "take_order", "manage_promotions")
	if !ok {
		return
	}
	categoryID, ok := optionalUintQuery(c, "category_id", "invalid category_id")
	if !ok {
		return
	}
	items, err := ctrl.menuSvc.ListMenuItems(restaurantID, memberCanAny(c, "manage_menu", "manage_promotions"), categoryID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"menu_items": items})
}

func (ctrl *MenuController) CreateMenuItem(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	var req service.MenuItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	item, err := ctrl.menuSvc.CreateMenuItem(restaurantID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (ctrl *MenuController) UpdateMenuItem(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	itemID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.MenuItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	item, err := ctrl.menuSvc.UpdateMenuItem(restaurantID, itemID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (ctrl *MenuController) UpdateMenuItemAvailability(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	itemID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req service.MenuItemAvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	item, err := ctrl.menuSvc.UpdateMenuItemAvailability(restaurantID, itemID, &req)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (ctrl *MenuController) DeleteMenuItem(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
		return
	}
	itemID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	if err := ctrl.menuSvc.DeleteMenuItem(restaurantID, itemID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (ctrl *MenuController) UploadMenuImage(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission")
	if !ok {
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
	removeBackground, backgroundStrength, err := parseMenuBackgroundOptions(
		c.PostForm("remove_background"),
		c.PostForm("background_strength"),
	)
	if err != nil {
		respondMenuBackgroundOptionError(c, err)
		return
	}
	relativeDir := filepath.Join("uploads", "menu", strconv.FormatUint(uint64(restaurantID), 10))

	opened, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read image"})
		return
	}
	source, readErr := io.ReadAll(opened)
	closeErr := opened.Close()
	if readErr != nil || closeErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read image"})
		return
	}
	processed, err := media.ProcessMenuImageUpload(c.Request.Context(), source, ext, media.MenuImageProcessOptions{
		RemoveBackground: removeBackground,
		Strength:         backgroundStrength,
	})
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	storedContents, storedExtension, backgroundRemoved, err := selectMenuImageForStorage(source, ext, processed, removeBackground)
	if err != nil {
		respondMenuBackgroundSelectionError(c, err)
		return
	}
	if err := ensureUploadQuota(relativeDir, int64(len(storedContents)), maxTenantImageFiles, maxTenantImageBytes); err != nil {
		respondAPIError(c, http.StatusInsufficientStorage, err)
		return
	}

	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate filename"})
		return
	}
	fileName := hex.EncodeToString(random) + storedExtension
	if err := os.MkdirAll(relativeDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare upload folder"})
		return
	}
	destination := filepath.Join(relativeDir, fileName)
	if err := saveMenuImageUpload(relativeDir, destination, storedContents); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save image"})
		return
	}

	publicPath := "/uploads/menu/" + strconv.FormatUint(uint64(restaurantID), 10) + "/" + fileName
	c.JSON(http.StatusCreated, gin.H{
		"image_url":          publicURL(c, publicPath),
		"path":               publicPath,
		"background_removed": backgroundRemoved,
	})
}

func (ctrl *MenuController) PreviewMenuImageBackground(c *gin.Context) {
	if _, ok := requireRestaurantWithPermission(c, "manage_menu", "missing manage_menu permission"); !ok {
		return
	}
	c.Header("Cache-Control", "no-store")

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
	_, strength, err := parseMenuBackgroundOptions("true", c.PostForm("background_strength"))
	if err != nil {
		respondMenuBackgroundOptionError(c, err)
		return
	}

	opened, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read image"})
		return
	}
	source, readErr := io.ReadAll(opened)
	closeErr := opened.Close()
	if readErr != nil || closeErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read image"})
		return
	}

	preview, err := media.PreviewMenuImageUpload(c.Request.Context(), source, ext, strength, maxImageUploadBytes)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	canRemove := preview.Result.BackgroundRemoved &&
		int64(len(preview.Result.Bytes)) <= maxImageUploadBytes &&
		len(preview.PreviewPNG) > 0
	previewDataURL := ""
	if canRemove {
		previewDataURL = "data:image/png;base64," + base64.StdEncoding.EncodeToString(preview.PreviewPNG)
	}
	c.JSON(http.StatusOK, gin.H{
		"can_remove":       canRemove,
		"preview_data_url": previewDataURL,
		"removed_ratio":    preview.Result.RemovedRatio,
		"strength":         strength,
	})
}

func parseMenuBackgroundOptions(removeRaw, strengthRaw string) (bool, int, error) {
	removeRaw = strings.ToLower(strings.TrimSpace(removeRaw))
	removeBackground := false
	switch removeRaw {
	case "", "false":
	case "true":
		removeBackground = true
	default:
		return false, 0, errInvalidRemoveBackground
	}
	strengthRaw = strings.TrimSpace(strengthRaw)
	if strengthRaw == "" {
		if removeBackground {
			return true, defaultMenuBackgroundStrength, nil
		}
		return false, 0, nil
	}
	strength, err := strconv.Atoi(strengthRaw)
	if err != nil || strength < 0 || strength > 100 {
		return false, 0, errInvalidBackgroundStrength
	}
	return removeBackground, strength, nil
}

func respondMenuBackgroundOptionError(c *gin.Context, err error) {
	code := "INVALID_BACKGROUND_STRENGTH"
	if errors.Is(err, errInvalidRemoveBackground) {
		code = "INVALID_REMOVE_BACKGROUND"
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": code})
}

func respondMenuBackgroundSelectionError(c *gin.Context, err error) {
	if errors.Is(err, errProcessedImageTooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": err.Error(),
			"code":  "PROCESSED_IMAGE_TOO_LARGE",
		})
		return
	}
	c.JSON(http.StatusUnprocessableEntity, gin.H{
		"error": err.Error(),
		"code":  "BACKGROUND_NOT_DETECTED",
	})
}

func selectMenuImageForStorage(source []byte, sourceExtension string, processed media.MenuImageResult, removeBackground bool) ([]byte, string, bool, error) {
	if !removeBackground {
		return source, sourceExtension, false, nil
	}
	if !processed.BackgroundRemoved {
		return nil, "", false, errBackgroundNotDetected
	}
	if int64(len(processed.Bytes)) > maxImageUploadBytes {
		return nil, "", false, errProcessedImageTooLarge
	}
	return processed.Bytes, processed.Extension, true, nil
}

func saveMenuImageUpload(directory, destination string, contents []byte) error {
	temporary, err := os.CreateTemp(directory, ".menu-image-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()

	if _, err := temporary.Write(contents); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Chmod(0644); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		return err
	}
	committed = true
	return nil
}
