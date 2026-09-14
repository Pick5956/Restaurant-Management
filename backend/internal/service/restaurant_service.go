package service

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

const (
	DefaultOwnerRoleName = "owner"
)

var restaurantTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

type RestaurantService struct {
	restaurantRepo *repository.RestaurantRepository
	memberRepo     *repository.RestaurantMemberRepository
	roleRepo       *repository.RoleRepository
	auditRepo      *repository.RestaurantAuditLogRepository
	setupRepo      repository.RestaurantSetupTransactor
}

func ProvideRestaurantService(
	restaurantRepo *repository.RestaurantRepository,
	memberRepo *repository.RestaurantMemberRepository,
	roleRepo *repository.RoleRepository,
	auditRepo *repository.RestaurantAuditLogRepository,
	setupRepo repository.RestaurantSetupTransactor,
) *RestaurantService {
	return &RestaurantService{
		restaurantRepo: restaurantRepo,
		memberRepo:     memberRepo,
		roleRepo:       roleRepo,
		auditRepo:      auditRepo,
		setupRepo:      setupRepo,
	}
}

type starterIngredient struct {
	Name         string
	SKU          string
	Unit         string
	Stock        float64
	MinStock     float64
	CostPerUnit  float64
	YieldPercent float64
	StorageType  string
}

type starterMenuItem struct {
	Name         string
	Price        float64
	Description  string
	OptionGroups []starterOptionGroup
	Recipe       []starterRecipeLine
}

// starterRecipeLine links a starter menu item to a starter ingredient (by name,
// resolved to an ID after the ingredient catalog has been seeded) so inventory
// deduction works out of the box for the default starter menu.
type starterRecipeLine struct {
	IngredientName string
	Quantity       float64
	Unit           string
}

type starterOptionGroup struct {
	Name      string
	Required  bool
	MinSelect int
	MaxSelect int
	Options   []starterOption
}

type starterOption struct {
	Name       string
	PriceDelta float64
	IsDefault  bool
}

type CreateRestaurantRequest struct {
	Name string `json:"name" binding:"required"`
	// Slug is the URL name the owner chose. Optional: when empty the service
	// derives one from the name, and the owner can change it in settings.
	Slug                 string  `json:"slug"`
	BranchName           string  `json:"branch_name" binding:"required"`
	RestaurantType       string  `json:"restaurant_type" binding:"required"`
	Address              string  `json:"address"`
	Phone                string  `json:"phone"`
	Logo                 string  `json:"logo"`
	OpenTime             string  `json:"open_time"`
	CloseTime            string  `json:"close_time"`
	TableCount           int     `json:"table_count"`
	ServiceChargeEnabled bool    `json:"service_charge_enabled"`
	ServiceChargeRate    float64 `json:"service_charge_rate"`
	VATEnabled           bool    `json:"vat_enabled"`
	VATRate              float64 `json:"vat_rate"`
	PromptPayName        string  `json:"promptpay_name"`
	PromptPayQRImage     string  `json:"promptpay_qr_image"`
	CoverImage           string  `json:"cover_image"`
	// SplitZones controls the starter table layout. When nil (older clients) or
	// true, tables are divided into the profile's zones; when false, they are
	// created as one flat, sequentially numbered run.
	SplitZones *bool `json:"split_zones"`
}

type UpdateRestaurantRequest struct {
	Name string `json:"name" binding:"required"`
	// Slug is opt-in like Logo: nil keeps the stored slug, so a client that
	// never shows the field (the mobile app) cannot clear or change it.
	Slug           *string `json:"slug"`
	BranchName     string  `json:"branch_name" binding:"required"`
	RestaurantType string  `json:"restaurant_type" binding:"required"`
	Address        string  `json:"address"`
	Phone          string  `json:"phone"`
	// Logo is opt-in: a payload that omits it keeps the stored logo rather than
	// clearing it. Sending an explicit "" still clears it, as before.
	Logo                 *string `json:"logo"`
	OpenTime             string  `json:"open_time"`
	CloseTime            string  `json:"close_time"`
	TableCount           int     `json:"table_count"`
	ServiceChargeEnabled bool    `json:"service_charge_enabled"`
	ServiceChargeRate    float64 `json:"service_charge_rate"`
	VATEnabled           bool    `json:"vat_enabled"`
	VATRate              float64 `json:"vat_rate"`
	PromptPayName        string  `json:"promptpay_name"`
	PromptPayQRImage     string  `json:"promptpay_qr_image"`
	CoverImage           string  `json:"cover_image"`
	// QR ordering geofence. Radius 0 (or missing coordinates) turns it off.
	Latitude          *float64 `json:"latitude"`
	Longitude         *float64 `json:"longitude"`
	OrderRadiusMeters int      `json:"order_radius_meters"`
}

type restaurantFields struct {
	Name                 string
	Slug                 string
	BranchName           string
	RestaurantType       string
	Address              string
	Phone                string
	Logo                 string
	OpenTime             string
	CloseTime            string
	TableCount           int
	ServiceChargeEnabled bool
	ServiceChargeRate    float64
	VATEnabled           bool
	VATRate              float64
	PromptPayName        string
	PromptPayQRImage     string
	CoverImage           string
}

// CreateRestaurant creates a restaurant and adds the creator as the owner member.
func (s *RestaurantService) CreateRestaurant(userID uint, req *CreateRestaurantRequest) (*entity.Restaurant, *entity.RestaurantMember, error) {
	fields, err := sanitizeRestaurantFields(
		req.Name,
		req.BranchName,
		req.RestaurantType,
		req.Address,
		req.Phone,
		req.Logo,
		req.OpenTime,
		req.CloseTime,
		req.TableCount,
		req.ServiceChargeEnabled,
		req.ServiceChargeRate,
		req.VATEnabled,
		req.VATRate,
		req.PromptPayName,
		req.PromptPayQRImage,
		req.CoverImage,
	)
	if err != nil {
		return nil, nil, err
	}

	if strings.TrimSpace(req.Slug) != "" {
		fields.Slug, err = resolveRequestedSlug(req.Slug, 0, s.restaurantRepo.SlugTaken)
	} else {
		fields.Slug, err = generateRestaurantSlug(fields.Name, s.restaurantRepo.SlugTaken)
	}
	if err != nil {
		return nil, nil, err
	}

	ownerRole, err := s.roleRepo.FindByName(DefaultOwnerRoleName)
	if err != nil {
		return nil, nil, errors.New("owner role is not configured")
	}

	// Default to the zoned layout so existing clients that omit the flag keep
	// their current behavior.
	splitZones := req.SplitZones == nil || *req.SplitZones
	restaurant, member, err := createRestaurantWithStarterData(s.setupRepo, userID, ownerRole.ID, *fields, splitZones)
	if err != nil {
		return nil, nil, err
	}

	// reload with relationships for response
	loaded, err := s.memberRepo.FindByUserAndRestaurant(userID, restaurant.ID)
	if err == nil {
		member = loaded
	}

	return restaurant, member, nil
}

func createRestaurantWithStarterData(
	setupRepo repository.RestaurantSetupTransactor,
	userID, ownerRoleID uint,
	fields restaurantFields,
	splitZones bool,
) (*entity.Restaurant, *entity.RestaurantMember, error) {
	var restaurant *entity.Restaurant
	var member *entity.RestaurantMember
	err := setupRepo.Transaction(func(tx repository.RestaurantSetupWriter) error {
		restaurant = &entity.Restaurant{
			Name:                 fields.Name,
			Slug:                 fields.Slug,
			BranchName:           fields.BranchName,
			RestaurantType:       fields.RestaurantType,
			Address:              fields.Address,
			Phone:                fields.Phone,
			Logo:                 fields.Logo,
			OpenTime:             fields.OpenTime,
			CloseTime:            fields.CloseTime,
			TableCount:           fields.TableCount,
			ServiceChargeEnabled: fields.ServiceChargeEnabled,
			ServiceChargeRate:    fields.ServiceChargeRate,
			VATEnabled:           fields.VATEnabled,
			VATRate:              fields.VATRate,
			PromptPayName:        fields.PromptPayName,
			PromptPayQRImage:     fields.PromptPayQRImage,
			CoverImage:           fields.CoverImage,
			OwnerID:              userID,
		}
		if err := tx.CreateRestaurant(restaurant); err != nil {
			return err
		}

		member = &entity.RestaurantMember{
			UserID:       userID,
			RestaurantID: restaurant.ID,
			RoleID:       ownerRoleID,
			Status:       "active",
			JoinedAt:     time.Now(),
		}
		if err := tx.CreateMember(member); err != nil {
			return err
		}
		return seedRestaurantStarterSetup(tx, restaurant.ID, fields.RestaurantType, fields.TableCount, splitZones)
	})
	if err != nil {
		return nil, nil, err
	}
	return restaurant, member, nil
}

func (s *RestaurantService) ListMyMemberships(userID uint) ([]entity.RestaurantMember, error) {
	members, err := s.memberRepo.FindActiveByUser(userID)
	if err != nil {
		return nil, err
	}
	return members, nil
}

func (s *RestaurantService) GetMembership(userID, restaurantID uint) (*entity.RestaurantMember, error) {
	member, err := s.memberRepo.FindByUserAndRestaurant(userID, restaurantID)
	if err != nil {
		return nil, err
	}
	if member.Status != "active" {
		return nil, errors.New("membership is not active")
	}
	return member, nil
}

func (s *RestaurantService) ListMembersForActor(actorUserID, restaurantID uint) ([]entity.RestaurantMember, error) {
	actor, err := s.GetMembership(actorUserID, restaurantID)
	if err != nil {
		return nil, err
	}
	if !canViewTeam(actor) {
		return nil, errors.New("missing team management permission")
	}
	return s.ListMembersWithStatus(restaurantID, true)
}

func (s *RestaurantService) ListMembersWithStatus(restaurantID uint, includeInactive bool) ([]entity.RestaurantMember, error) {
	var (
		members []entity.RestaurantMember
		err     error
	)

	if includeInactive {
		members, err = s.memberRepo.FindAllByRestaurant(restaurantID)
	} else {
		members, err = s.memberRepo.FindActiveByRestaurant(restaurantID)
	}
	if err != nil {
		return nil, err
	}
	return members, nil
}

func (s *RestaurantService) UpdateMemberStatus(actorUserID, restaurantID, memberID uint, nextStatus string) (*entity.RestaurantMember, error) {
	if !isMembershipStatusAllowed(nextStatus) {
		return nil, errors.New("invalid member status")
	}

	actor, target, err := s.loadManagedMemberPair(actorUserID, restaurantID, memberID, PermissionManageMembers)
	if err != nil {
		return nil, err
	}
	if !canManageMemberWithPermission(actor, target, PermissionManageMembers) {
		return nil, errors.New("you do not have permission to manage this member")
	}

	if target.Status == nextStatus {
		return target, nil
	}

	previousStatus := target.Status
	target.Status = nextStatus
	if err := s.memberRepo.Update(target); err != nil {
		return nil, err
	}

	updated, err := s.memberRepo.FindByID(target.ID)
	if err != nil {
		return nil, err
	}

	actorID := actor.UserID
	targetUserID := updated.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionMemberStatusChanged,
		&actorID,
		&targetUserID,
		nil,
		map[string]any{
			"from_status": previousStatus,
			"to_status":   nextStatus,
			"role_name":   roleName(updated.Role),
		},
	)

	return updated, nil
}

func (s *RestaurantService) UpdateMemberRole(actorUserID, restaurantID, memberID, roleID uint) (*entity.RestaurantMember, error) {
	actor, target, err := s.loadManagedMemberPair(actorUserID, restaurantID, memberID, PermissionManageRoles)
	if err != nil {
		return nil, err
	}
	if !canManageMemberWithPermission(actor, target, PermissionManageRoles) {
		return nil, errors.New("you do not have permission to manage this member")
	}

	role, err := s.roleRepo.FindByIDForRestaurant(roleID, restaurantID)
	if err != nil {
		return nil, errors.New("role not found")
	}
	if !roleAssignableToRestaurant(role, restaurantID) || !canAssignMemberRole(actor, role) {
		return nil, errors.New("you do not have permission to assign this role")
	}
	if role.RestaurantID == nil {
		hidden, err := s.roleRepo.IsRoleHiddenForRestaurant(restaurantID, role.ID)
		if err != nil {
			return nil, err
		}
		if hidden {
			return nil, errors.New("role is not available for this restaurant")
		}
	}
	if target.Role != nil && target.Role.Name == role.Name {
		return target, nil
	}

	previousRole := roleName(target.Role)
	assignMemberRole(target, role)
	if err := s.memberRepo.Update(target); err != nil {
		return nil, err
	}

	updated, err := s.memberRepo.FindByID(target.ID)
	if err != nil {
		return nil, err
	}

	actorID := actor.UserID
	targetUserID := updated.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionMemberRoleChanged,
		&actorID,
		&targetUserID,
		nil,
		map[string]any{
			"from_role": previousRole,
			"to_role":   roleName(role),
			"status":    updated.Status,
		},
	)

	return updated, nil
}

func (s *RestaurantService) UpdateMemberPermissions(actorUserID, restaurantID, memberID uint, permissionsOverride *([]string)) (*entity.RestaurantMember, error) {
	actor, target, err := s.loadManagedMemberPair(actorUserID, restaurantID, memberID, PermissionManageRoles)
	if err != nil {
		return nil, err
	}
	if !canManageMemberWithPermission(actor, target, PermissionManageRoles) {
		return nil, errors.New("you do not have permission to manage this member")
	}

	previous := target.PermissionsOverride
	if permissionsOverride == nil {
		if target.Role == nil || !roleWithinGrantCeiling(actor, target.Role) {
			return nil, errors.New("cannot grant permissions you do not possess")
		}
		target.PermissionsOverride = nil
	} else {
		normalized, err := normalizePermissions(*permissionsOverride)
		if err != nil {
			return nil, err
		}
		if !permissionsWithinGrantCeiling(actor, normalized) {
			return nil, errors.New("cannot grant permissions you do not possess")
		}
		raw, err := json.Marshal(normalized)
		if err != nil {
			return nil, err
		}
		next := string(raw)
		target.PermissionsOverride = &next
	}

	if err := s.memberRepo.Update(target); err != nil {
		return nil, err
	}

	updated, err := s.memberRepo.FindByID(target.ID)
	if err != nil {
		return nil, err
	}

	var previousValue any
	if previous != nil {
		previousValue = *previous
	}
	var nextValue any
	if updated.PermissionsOverride != nil {
		nextValue = *updated.PermissionsOverride
	}
	actorID := actor.UserID
	targetUserID := updated.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionMemberPermissionsChanged,
		&actorID,
		&targetUserID,
		nil,
		map[string]any{
			"from_permissions_override": previousValue,
			"to_permissions_override":   nextValue,
			"role_name":                 roleName(updated.Role),
			"status":                    updated.Status,
		},
	)

	return updated, nil
}

func (s *RestaurantService) ListAuditLogs(actorUserID, restaurantID uint, limit int, offset int) ([]entity.RestaurantAuditLog, error) {
	actor, err := s.GetMembership(actorUserID, restaurantID)
	if err != nil {
		return nil, err
	}
	if !memberHasPermission(actor, PermissionViewAuditLog) {
		return nil, errors.New("missing view_audit_log permission")
	}
	return s.auditRepo.ListByRestaurant(restaurantID, limit, offset)
}

func (s *RestaurantService) GetRestaurant(restaurantID uint) (*entity.Restaurant, error) {
	return s.restaurantRepo.FindByID(restaurantID)
}

func (s *RestaurantService) UpdateRestaurant(restaurantID uint, req *UpdateRestaurantRequest) (*entity.Restaurant, error) {
	restaurant, err := s.restaurantRepo.FindByID(restaurantID)
	if err != nil {
		return nil, errors.New("restaurant not found")
	}

	// Clients that never render a logo field (the web settings form) omit it
	// entirely; keep what is stored instead of wiping it.
	logo := restaurant.Logo
	if req.Logo != nil {
		logo = *req.Logo
	}

	fields, err := sanitizeRestaurantFields(
		req.Name,
		req.BranchName,
		req.RestaurantType,
		req.Address,
		req.Phone,
		logo,
		req.OpenTime,
		req.CloseTime,
		req.TableCount,
		req.ServiceChargeEnabled,
		req.ServiceChargeRate,
		req.VATEnabled,
		req.VATRate,
		req.PromptPayName,
		req.PromptPayQRImage,
		req.CoverImage,
	)
	if err != nil {
		return nil, err
	}

	if req.Slug != nil && restaurantslugChanged(restaurant.Slug, *req.Slug) {
		slug, err := resolveRequestedSlug(*req.Slug, restaurant.ID, s.restaurantRepo.SlugTaken)
		if err != nil {
			return nil, err
		}
		restaurant.Slug = slug
	}

	restaurant.Name = fields.Name
	restaurant.BranchName = fields.BranchName
	restaurant.RestaurantType = fields.RestaurantType
	restaurant.Address = fields.Address
	restaurant.Phone = fields.Phone
	restaurant.Logo = fields.Logo
	restaurant.OpenTime = fields.OpenTime
	restaurant.CloseTime = fields.CloseTime
	restaurant.TableCount = fields.TableCount
	restaurant.ServiceChargeEnabled = fields.ServiceChargeEnabled
	restaurant.ServiceChargeRate = fields.ServiceChargeRate
	restaurant.VATEnabled = fields.VATEnabled
	restaurant.VATRate = fields.VATRate
	restaurant.PromptPayName = fields.PromptPayName
	restaurant.PromptPayQRImage = fields.PromptPayQRImage
	restaurant.CoverImage = fields.CoverImage

	latitude, longitude, radius, err := sanitizeGeofence(req.Latitude, req.Longitude, req.OrderRadiusMeters)
	if err != nil {
		return nil, err
	}
	restaurant.Latitude = latitude
	restaurant.Longitude = longitude
	restaurant.OrderRadiusMeters = radius

	if err := s.restaurantRepo.Update(restaurant); err != nil {
		return nil, err
	}
	return s.restaurantRepo.FindByID(restaurantID)
}

// sanitizeGeofence validates the QR-ordering geofence settings. Any incomplete
// configuration disables the feature instead of half-applying it.
func sanitizeGeofence(latitude, longitude *float64, radiusMeters int) (*float64, *float64, int, error) {
	if latitude == nil || longitude == nil || radiusMeters <= 0 {
		return nil, nil, 0, nil
	}
	if *latitude < -90 || *latitude > 90 {
		return nil, nil, 0, errors.New("latitude must be between -90 and 90")
	}
	if *longitude < -180 || *longitude > 180 {
		return nil, nil, 0, errors.New("longitude must be between -180 and 180")
	}
	if radiusMeters < 20 || radiusMeters > 5000 {
		return nil, nil, 0, errors.New("order radius must be between 20 and 5000 meters")
	}
	return latitude, longitude, radiusMeters, nil
}

func (s *RestaurantService) UpdateRestaurantLogo(restaurantID uint, logo string) (*entity.Restaurant, error) {
	restaurant, err := s.restaurantRepo.FindByID(restaurantID)
	if err != nil {
		return nil, errors.New("restaurant not found")
	}

	restaurant.Logo = strings.TrimSpace(logo)
	if err := s.restaurantRepo.Update(restaurant); err != nil {
		return nil, err
	}
	return s.restaurantRepo.FindByID(restaurantID)
}

func (s *RestaurantService) UpdateRestaurantCover(restaurantID uint, coverImage string) (*entity.Restaurant, error) {
	restaurant, err := s.restaurantRepo.FindByID(restaurantID)
	if err != nil {
		return nil, errors.New("restaurant not found")
	}

	restaurant.CoverImage = strings.TrimSpace(coverImage)
	if err := s.restaurantRepo.Update(restaurant); err != nil {
		return nil, err
	}
	return s.restaurantRepo.FindByID(restaurantID)
}

func (s *RestaurantService) UpdateRestaurantPromptPayQR(restaurantID uint, qrImage string) (*entity.Restaurant, error) {
	restaurant, err := s.restaurantRepo.FindByID(restaurantID)
	if err != nil {
		return nil, errors.New("restaurant not found")
	}

	restaurant.PromptPayQRImage = strings.TrimSpace(qrImage)
	if err := s.restaurantRepo.Update(restaurant); err != nil {
		return nil, err
	}
	return s.restaurantRepo.FindByID(restaurantID)
}

func (s *RestaurantService) DeleteRestaurant(restaurantID uint) error {
	if err := s.memberRepo.DeleteByRestaurant(restaurantID); err != nil {
		return err
	}
	return s.restaurantRepo.Delete(restaurantID)
}
