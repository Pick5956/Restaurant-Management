package service

import (
	"strings"
	"time"

	"Project-M/internal/entity"
)

// UserSummary is the deliberately small user shape that may be nested in a
// restaurant membership response.
type UserSummary struct {
	ID           uint   `json:"ID"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Nickname     string `json:"nickname"`
	ProfileImage string `json:"profile_image"`
}

type RoleResponse struct {
	ID                  uint    `json:"ID"`
	RestaurantID        *uint   `json:"restaurant_id,omitempty"`
	Name                string  `json:"name"`
	DisplayName         string  `json:"display_name"`
	DisplayNameOverride *string `json:"display_name_override,omitempty"`
	Permissions         string  `json:"permissions"`
	IsSystem            bool    `json:"is_system"`
}

// RestaurantResponse contains the operational restaurant fields clients need
// without nesting the owner user record.
type RestaurantResponse struct {
	ID                   uint    `json:"ID"`
	Name                 string  `json:"name"`
	Slug                 string  `json:"slug"`
	BranchName           string  `json:"branch_name"`
	RestaurantType       string  `json:"restaurant_type"`
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
	OwnerID              uint    `json:"owner_id"`
}

type MembershipResponse struct {
	ID                  uint                `json:"ID"`
	CreatedAt           time.Time           `json:"CreatedAt"`
	UpdatedAt           time.Time           `json:"UpdatedAt"`
	UserID              uint                `json:"user_id"`
	RestaurantID        uint                `json:"restaurant_id"`
	RoleID              uint                `json:"role_id"`
	Status              string              `json:"status"`
	PermissionsOverride *string             `json:"permissions_override,omitempty"`
	JoinedAt            time.Time           `json:"joined_at"`
	InvitedByUserID     *uint               `json:"invited_by_user_id"`
	User                *UserSummary        `json:"user,omitempty"`
	Restaurant          *RestaurantResponse `json:"restaurant,omitempty"`
	Role                *RoleResponse       `json:"role,omitempty"`
}

func NewMembershipResponse(member *entity.RestaurantMember) MembershipResponse {
	if member == nil {
		return MembershipResponse{}
	}

	response := MembershipResponse{
		ID:                  member.ID,
		CreatedAt:           member.CreatedAt,
		UpdatedAt:           member.UpdatedAt,
		UserID:              member.UserID,
		RestaurantID:        member.RestaurantID,
		RoleID:              member.RoleID,
		Status:              member.Status,
		PermissionsOverride: member.PermissionsOverride,
		JoinedAt:            member.JoinedAt,
		InvitedByUserID:     member.InvitedByUserID,
	}
	if member.User != nil {
		response.User = &UserSummary{
			ID:           member.User.ID,
			Email:        member.User.Email,
			FirstName:    member.User.FirstName,
			LastName:     member.User.LastName,
			Nickname:     member.User.Nickname,
			ProfileImage: member.User.ProfileImage,
		}
	}
	response.Restaurant = newRestaurantResponse(member.Restaurant)
	response.Role = newRoleResponse(member.Role, true)
	return response
}

func NewMembershipResponses(members []entity.RestaurantMember) []MembershipResponse {
	responses := make([]MembershipResponse, 0, len(members))
	for index := range members {
		responses = append(responses, NewMembershipResponse(&members[index]))
	}
	return responses
}

type InvitationRestaurantSummary struct {
	ID         uint   `json:"ID"`
	Name       string `json:"name"`
	BranchName string `json:"branch_name"`
	Address    string `json:"address"`
	Logo       string `json:"logo"`
}

type InvitationRoleSummary struct {
	ID                  uint    `json:"ID"`
	RestaurantID        *uint   `json:"restaurant_id,omitempty"`
	Name                string  `json:"name"`
	DisplayName         string  `json:"display_name"`
	DisplayNameOverride *string `json:"display_name_override,omitempty"`
	IsSystem            bool    `json:"is_system"`
}

type PublicInvitationResponse struct {
	ID           uint                         `json:"ID"`
	CreatedAt    time.Time                    `json:"CreatedAt"`
	UpdatedAt    time.Time                    `json:"UpdatedAt"`
	RestaurantID uint                         `json:"restaurant_id"`
	RoleID       uint                         `json:"role_id"`
	Email        string                       `json:"email"`
	ExpiresAt    *time.Time                   `json:"expires_at"`
	Status       string                       `json:"status"`
	AcceptedAt   *time.Time                   `json:"accepted_at"`
	Restaurant   *InvitationRestaurantSummary `json:"restaurant,omitempty"`
	Role         *InvitationRoleSummary       `json:"role,omitempty"`
}

type AdminInvitationResponse struct {
	PublicInvitationResponse
	Token            string `json:"token"`
	Email            string `json:"email"`
	InvitedByUserID  uint   `json:"invited_by_user_id"`
	AcceptedByUserID *uint  `json:"accepted_by_user_id"`
}

func NewPublicInvitationResponse(invitation *entity.Invitation) PublicInvitationResponse {
	if invitation == nil {
		return PublicInvitationResponse{}
	}

	response := PublicInvitationResponse{
		ID:           invitation.ID,
		CreatedAt:    invitation.CreatedAt,
		UpdatedAt:    invitation.UpdatedAt,
		RestaurantID: invitation.RestaurantID,
		RoleID:       invitation.RoleID,
		Email:        maskInvitationEmail(invitation.Email),
		ExpiresAt:    invitation.ExpiresAt,
		Status:       invitation.Status,
		AcceptedAt:   invitation.AcceptedAt,
	}
	if invitation.Restaurant != nil {
		response.Restaurant = &InvitationRestaurantSummary{
			ID:         invitation.Restaurant.ID,
			Name:       invitation.Restaurant.Name,
			BranchName: invitation.Restaurant.BranchName,
			Address:    invitation.Restaurant.Address,
			Logo:       invitation.Restaurant.Logo,
		}
	}
	if invitation.Role != nil {
		response.Role = &InvitationRoleSummary{
			ID:                  invitation.Role.ID,
			RestaurantID:        invitation.Role.RestaurantID,
			Name:                invitation.Role.Name,
			DisplayName:         invitation.Role.DisplayName,
			DisplayNameOverride: invitation.Role.DisplayNameOverride,
			IsSystem:            invitation.Role.IsSystem,
		}
	}
	return response
}

func NewAdminInvitationResponse(invitation *entity.Invitation) AdminInvitationResponse {
	if invitation == nil {
		return AdminInvitationResponse{}
	}
	return AdminInvitationResponse{
		PublicInvitationResponse: NewPublicInvitationResponse(invitation),
		Token:                    invitation.Token,
		Email:                    invitation.Email,
		InvitedByUserID:          invitation.InvitedByUserID,
		AcceptedByUserID:         invitation.AcceptedByUserID,
	}
}

func maskInvitationEmail(email string) string {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return ""
	}
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" || domain == "" {
		return ""
	}

	localRunes := []rune(local)
	domainName, suffix, _ := strings.Cut(domain, ".")
	domainRunes := []rune(domainName)
	if len(localRunes) == 0 || len(domainRunes) == 0 {
		return ""
	}

	maskedDomain := string(domainRunes[0]) + "***"
	if suffix != "" {
		maskedDomain += "." + suffix
	}
	return string(localRunes[0]) + "***@" + maskedDomain
}

func NewAdminInvitationResponses(invitations []entity.Invitation) []AdminInvitationResponse {
	responses := make([]AdminInvitationResponse, 0, len(invitations))
	for index := range invitations {
		responses = append(responses, NewAdminInvitationResponse(&invitations[index]))
	}
	return responses
}

func newRoleResponse(role *entity.Role, includePermissions bool) *RoleResponse {
	if role == nil {
		return nil
	}
	response := &RoleResponse{
		ID:                  role.ID,
		RestaurantID:        role.RestaurantID,
		Name:                role.Name,
		DisplayName:         role.DisplayName,
		DisplayNameOverride: role.DisplayNameOverride,
		IsSystem:            role.IsSystem,
	}
	if includePermissions {
		response.Permissions = role.Permissions
	}
	return response
}

func newRestaurantResponse(restaurant *entity.Restaurant) *RestaurantResponse {
	if restaurant == nil {
		return nil
	}
	return &RestaurantResponse{
		ID:                   restaurant.ID,
		Name:                 restaurant.Name,
		Slug:                 restaurant.Slug,
		BranchName:           restaurant.BranchName,
		RestaurantType:       restaurant.RestaurantType,
		Address:              restaurant.Address,
		Phone:                restaurant.Phone,
		Logo:                 restaurant.Logo,
		OpenTime:             restaurant.OpenTime,
		CloseTime:            restaurant.CloseTime,
		TableCount:           restaurant.TableCount,
		ServiceChargeEnabled: restaurant.ServiceChargeEnabled,
		ServiceChargeRate:    restaurant.ServiceChargeRate,
		VATEnabled:           restaurant.VATEnabled,
		VATRate:              restaurant.VATRate,
		PromptPayName:        restaurant.PromptPayName,
		PromptPayQRImage:     restaurant.PromptPayQRImage,
		CoverImage:           restaurant.CoverImage,
		OwnerID:              restaurant.OwnerID,
	}
}

// UserResponse is the public shape returned for a single user account. It omits
// the embedded gorm.Model bookkeeping fields (CreatedAt/UpdatedAt/DeletedAt) so
// endpoints such as register do not over-disclose internal record state
// (DISHY-09). Password and other sensitive fields are already `json:"-"` on the
// entity.
type UserResponse struct {
	ID           uint   `json:"ID"`
	Email        string `json:"email"`
	AuthProvider string `json:"auth_provider"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Nickname     string `json:"nickname"`
	Phone        string `json:"phone"`
	Address      string `json:"address"`
	BirthDay     string `json:"birthday"`
	ProfileImage string `json:"profile_image"`
	Status       string `json:"status"`
}

func NewUserResponse(user *entity.User) *UserResponse {
	if user == nil {
		return nil
	}
	return &UserResponse{
		ID:           user.ID,
		Email:        user.Email,
		AuthProvider: user.AuthProvider,
		FirstName:    user.FirstName,
		LastName:     user.LastName,
		Nickname:     user.Nickname,
		Phone:        user.Phone,
		Address:      user.Address,
		BirthDay:     user.BirthDay,
		ProfileImage: user.ProfileImage,
		Status:       user.Status,
	}
}
