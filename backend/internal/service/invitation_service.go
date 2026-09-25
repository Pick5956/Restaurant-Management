package service

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/mail"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"

	"gorm.io/gorm"
)

type InvitationService struct {
	invRepo      *repository.InvitationRepository
	acceptanceTx repository.InvitationAcceptanceTransactionRunner
	memberRepo   *repository.RestaurantMemberRepository
	roleRepo     *repository.RoleRepository
	userRepo     *repository.UserRepository
	auditRepo    *repository.RestaurantAuditLogRepository
}

const invitationTokenBytes = 24

func ProvideInvitationService(
	invRepo *repository.InvitationRepository,
	memberRepo *repository.RestaurantMemberRepository,
	roleRepo *repository.RoleRepository,
	userRepo *repository.UserRepository,
	auditRepo *repository.RestaurantAuditLogRepository,
) *InvitationService {
	return &InvitationService{
		invRepo:      invRepo,
		acceptanceTx: invRepo,
		memberRepo:   memberRepo,
		roleRepo:     roleRepo,
		userRepo:     userRepo,
		auditRepo:    auditRepo,
	}
}

type CreateInvitationRequest struct {
	RoleID        uint   `json:"role_id" binding:"required"`
	Email         string `json:"email"`
	ExpiresInDays int    `json:"expires_in_days"` // 0 = no expiry
}

func (s *InvitationService) CreateInvitation(restaurantID, invitedByUserID uint, req *CreateInvitationRequest) (*entity.Invitation, error) {
	actor, err := s.authorizeInvitationManager(invitedByUserID, restaurantID)
	if err != nil {
		return nil, err
	}

	role, err := s.roleRepo.FindByIDForRestaurant(req.RoleID, restaurantID)
	if err != nil {
		return nil, errors.New("role not found")
	}
	if !roleAssignableToRestaurant(role, restaurantID) || !canGrantRole(actor, role) {
		return nil, errors.New("role cannot be invited")
	}
	if role.RestaurantID == nil {
		hidden, err := s.roleRepo.IsRoleHiddenForRestaurant(restaurantID, role.ID)
		if err != nil {
			return nil, err
		}
		if hidden {
			return nil, errors.New("role cannot be invited")
		}
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil {
			return nil, errors.New("invalid invitation email")
		}
	}
	if req.ExpiresInDays < 0 || req.ExpiresInDays > 90 {
		return nil, errors.New("expires_in_days must be between 0 and 90")
	}

	token, err := generateInviteToken()
	if err != nil {
		return nil, err
	}

	var expiresAt *time.Time
	if req.ExpiresInDays > 0 {
		t := time.Now().AddDate(0, 0, req.ExpiresInDays)
		expiresAt = &t
	}

	inv := &entity.Invitation{
		RestaurantID:    restaurantID,
		RoleID:          req.RoleID,
		Email:           email,
		Token:           token,
		ExpiresAt:       expiresAt,
		Status:          entity.InvitationStatusPending,
		InvitedByUserID: invitedByUserID,
	}
	if err := s.invRepo.Create(inv); err != nil {
		return nil, err
	}

	loaded, err := s.invRepo.FindByID(inv.ID)
	if err == nil {
		writeAuditEvent(
			s.auditRepo,
			restaurantID,
			entity.AuditActionInvitationCreated,
			&invitedByUserID,
			nil,
			&loaded.ID,
			map[string]any{
				"email":      loaded.Email,
				"role_name":  roleName(role),
				"expires_at": loaded.ExpiresAt,
			},
		)
		return loaded, nil
	}

	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionInvitationCreated,
		&invitedByUserID,
		nil,
		&inv.ID,
		map[string]any{
			"email":      inv.Email,
			"role_name":  roleName(role),
			"expires_at": inv.ExpiresAt,
		},
	)
	return inv, nil
}

// GetByToken returns an invitation by its token plus a derived "usable" status.
// Marks the invitation expired if its expiry has passed and status was pending.
func (s *InvitationService) GetByToken(token string) (*entity.Invitation, error) {
	token, err := normalizeInvitationToken(token)
	if err != nil {
		return nil, err
	}
	inv, err := s.invRepo.FindByToken(token)
	if err != nil {
		return nil, err
	}

	// auto-flip to expired if past expiry
	if inv.Status == entity.InvitationStatusPending && inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
		inv.Status = entity.InvitationStatusExpired
		_ = s.invRepo.MarkExpiredIfPending(inv.ID)
	}
	return inv, nil
}

// AcceptInvitation creates a RestaurantMember from a usable invitation for the given user.
// Validates token, status, expiry, email match (if scoped), and existing membership.
func (s *InvitationService) AcceptInvitation(userID uint, token string) (*entity.RestaurantMember, error) {
	var err error
	token, err = normalizeInvitationToken(token)
	if err != nil {
		return nil, err
	}
	if s.acceptanceTx == nil {
		return nil, errors.New("invitation acceptance is unavailable")
	}

	var acceptedInvitation *entity.Invitation
	var acceptedMember *entity.RestaurantMember
	err = s.acceptanceTx.WithInvitationAcceptanceTransaction(func(store repository.InvitationAcceptanceStore) error {
		invitation, err := store.FindInvitationByTokenForUpdate(token)
		if err != nil {
			return err
		}
		if !invitation.IsUsable() {
			return errors.New("invitation is no longer usable")
		}

		user, err := store.FindUserByID(userID)
		if err != nil {
			return err
		}
		if user.Status != "active" {
			return errors.New("user account is not active")
		}

		// The email guard intentionally precedes all membership reads and writes.
		// A mismatched invite must not reactivate or change an old membership.
		if invitation.Email != "" && !strings.EqualFold(user.Email, invitation.Email) {
			return errors.New("invitation is for a different email")
		}

		member, err := store.FindMemberByUserAndRestaurant(userID, invitation.RestaurantID)
		switch {
		case err == nil:
			// A suspension is a decision someone made about this person; an
			// invite link must not undo it. Only a removed member may rejoin.
			if member.Status == "suspended" {
				return errors.New("membership is suspended")
			}
			if member.Status != "active" {
				member.RoleID = invitation.RoleID
				member.Status = "active"
				member.PermissionsOverride = nil
				member.InvitedByUserID = &invitation.InvitedByUserID
				if err := store.UpdateMember(member); err != nil {
					return err
				}
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			now := time.Now()
			invitedBy := invitation.InvitedByUserID
			member = &entity.RestaurantMember{
				UserID:          userID,
				RestaurantID:    invitation.RestaurantID,
				RoleID:          invitation.RoleID,
				Status:          "active",
				JoinedAt:        now,
				InvitedByUserID: &invitedBy,
			}
			if err := store.CreateMember(member); err != nil {
				return err
			}
		default:
			return err
		}

		now := time.Now()
		acceptedBy := userID
		invitation.Status = entity.InvitationStatusAccepted
		invitation.AcceptedAt = &now
		invitation.AcceptedByUserID = &acceptedBy
		if err := store.UpdateInvitation(invitation); err != nil {
			return err
		}

		if loaded, err := store.FindMemberByUserAndRestaurant(userID, invitation.RestaurantID); err == nil {
			member = loaded
		}
		acceptedInvitation = invitation
		acceptedMember = member
		return nil
	})
	if err != nil {
		return nil, err
	}

	s.logInvitationAccepted(acceptedInvitation, userID, acceptedMember)
	return acceptedMember, nil
}

func (s *InvitationService) RevokeInvitation(actorUserID, restaurantID, invitationID uint) error {
	if _, err := s.authorizeInvitationManager(actorUserID, restaurantID); err != nil {
		return err
	}

	inv, err := s.invRepo.FindByID(invitationID)
	if err != nil {
		return err
	}
	if inv.RestaurantID != restaurantID {
		return errors.New("invitation does not belong to this restaurant")
	}
	if inv.Status != entity.InvitationStatusPending {
		return errors.New("only pending invitations can be revoked")
	}
	if err := s.invRepo.RevokePending(inv.ID, restaurantID); err != nil {
		return err
	}
	inv.Status = entity.InvitationStatusRevoked

	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionInvitationRevoked,
		&actorUserID,
		nil,
		&inv.ID,
		map[string]any{
			"email":     inv.Email,
			"role_name": roleName(inv.Role),
		},
	)

	return nil
}

func (s *InvitationService) ListPending(actorUserID, restaurantID uint) ([]entity.Invitation, error) {
	if _, err := s.authorizeInvitationManager(actorUserID, restaurantID); err != nil {
		return nil, err
	}
	return s.invRepo.ListPendingByRestaurant(restaurantID)
}

func (s *InvitationService) authorizeInvitationManager(userID, restaurantID uint) (*entity.RestaurantMember, error) {
	if s.memberRepo == nil {
		return nil, errors.New("membership authorization is unavailable")
	}
	member, err := s.memberRepo.FindByUserAndRestaurant(userID, restaurantID)
	if err != nil || member == nil || member.Status != "active" || member.RestaurantID != restaurantID {
		return nil, errors.New("not an active member of this restaurant")
	}
	if !invitationManagerCanAct(member, restaurantID) {
		return nil, errors.New("you do not have permission to manage invitations")
	}
	return member, nil
}

func invitationManagerCanAct(member *entity.RestaurantMember, restaurantID uint) bool {
	return member != nil &&
		member.RestaurantID == restaurantID &&
		member.Status == "active" &&
		canManageInvites(member)
}

func generateInviteToken() (string, error) {
	bytes := make([]byte, invitationTokenBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func normalizeInvitationToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if len(token) != base64.RawURLEncoding.EncodedLen(invitationTokenBytes) {
		return "", errors.New("invalid invitation token")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != invitationTokenBytes {
		return "", errors.New("invalid invitation token")
	}
	return token, nil
}

func (s *InvitationService) logInvitationAccepted(inv *entity.Invitation, userID uint, member *entity.RestaurantMember) {
	targetUserID := userID
	invitationID := inv.ID
	writeAuditEvent(
		s.auditRepo,
		inv.RestaurantID,
		entity.AuditActionInvitationAccepted,
		&targetUserID,
		&targetUserID,
		&invitationID,
		map[string]any{
			"email":         inv.Email,
			"role_name":     roleName(member.Role),
			"member_id":     member.ID,
			"member_status": member.Status,
		},
	)
}
