package service

import (
	"errors"
	"sync"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"

	"gorm.io/gorm"
)

const testInvitationToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type memoryInvitationAcceptanceRunner struct {
	mu         sync.Mutex
	invitation entity.Invitation
	users      map[uint]entity.User
	members    map[[2]uint]entity.RestaurantMember
}

func (r *memoryInvitationAcceptanceRunner) WithInvitationAcceptanceTransaction(
	fn func(repository.InvitationAcceptanceStore) error,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	invitationSnapshot := r.invitation
	memberSnapshot := make(map[[2]uint]entity.RestaurantMember, len(r.members))
	for key, member := range r.members {
		memberSnapshot[key] = member
	}

	store := &memoryInvitationAcceptanceStore{runner: r}
	if err := fn(store); err != nil {
		r.invitation = invitationSnapshot
		r.members = memberSnapshot
		return err
	}
	return nil
}

type memoryInvitationAcceptanceStore struct {
	runner *memoryInvitationAcceptanceRunner
}

func (s *memoryInvitationAcceptanceStore) FindInvitationByTokenForUpdate(token string) (*entity.Invitation, error) {
	if s.runner.invitation.Token != token {
		return nil, gorm.ErrRecordNotFound
	}
	copy := s.runner.invitation
	return &copy, nil
}

func (s *memoryInvitationAcceptanceStore) FindMemberByUserAndRestaurant(userID, restaurantID uint) (*entity.RestaurantMember, error) {
	member, ok := s.runner.members[[2]uint{userID, restaurantID}]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copy := member
	return &copy, nil
}

func (s *memoryInvitationAcceptanceStore) FindUserByID(userID uint) (*entity.User, error) {
	user, ok := s.runner.users[userID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copy := user
	return &copy, nil
}

func (s *memoryInvitationAcceptanceStore) CreateMember(member *entity.RestaurantMember) error {
	key := [2]uint{member.UserID, member.RestaurantID}
	if _, exists := s.runner.members[key]; exists {
		return errors.New("duplicate member")
	}
	copy := *member
	copy.ID = uint(len(s.runner.members) + 1)
	s.runner.members[key] = copy
	member.ID = copy.ID
	return nil
}

func (s *memoryInvitationAcceptanceStore) UpdateMember(member *entity.RestaurantMember) error {
	key := [2]uint{member.UserID, member.RestaurantID}
	s.runner.members[key] = *member
	return nil
}

func (s *memoryInvitationAcceptanceStore) UpdateInvitation(invitation *entity.Invitation) error {
	s.runner.invitation = *invitation
	return nil
}

func TestAcceptInvitationChecksEmailBeforeReactivatingMembership(t *testing.T) {
	runner := &memoryInvitationAcceptanceRunner{
		invitation: entity.Invitation{
			RestaurantID: 5,
			RoleID:       3,
			Email:        "intended@example.test",
			Token:        testInvitationToken,
			Status:       entity.InvitationStatusPending,
		},
		users: map[uint]entity.User{
			9: {Email: "removed@example.test", Status: "active"},
		},
		members: map[[2]uint]entity.RestaurantMember{
			{9, 5}: {UserID: 9, RestaurantID: 5, RoleID: 4, Status: "removed"},
		},
	}
	service := &InvitationService{acceptanceTx: runner}

	if _, err := service.AcceptInvitation(9, testInvitationToken); err == nil {
		t.Fatal("AcceptInvitation() accepted an invitation for another email")
	}
	member := runner.members[[2]uint{9, 5}]
	if member.Status != "removed" || member.RoleID != 4 {
		t.Fatalf("mismatched invite mutated membership: %+v", member)
	}
	if runner.invitation.Status != entity.InvitationStatusPending {
		t.Fatalf("mismatched invite status = %q, want pending", runner.invitation.Status)
	}
}

func TestAcceptInvitationIsSingleUseUnderConcurrency(t *testing.T) {
	runner := &memoryInvitationAcceptanceRunner{
		invitation: entity.Invitation{
			RestaurantID: 5,
			RoleID:       3,
			Token:        testInvitationToken,
			Status:       entity.InvitationStatusPending,
		},
		users: map[uint]entity.User{
			10: {Email: "first@example.test", Status: "active"},
			11: {Email: "second@example.test", Status: "active"},
		},
		members: map[[2]uint]entity.RestaurantMember{},
	}
	service := &InvitationService{acceptanceTx: runner}

	results := make(chan error, 2)
	for _, userID := range []uint{10, 11} {
		go func(id uint) {
			_, err := service.AcceptInvitation(id, testInvitationToken)
			results <- err
		}(userID)
	}

	successes := 0
	for range 2 {
		if err := <-results; err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("successful accepts = %d, want exactly 1", successes)
	}
	if len(runner.members) != 1 {
		t.Fatalf("created memberships = %d, want 1", len(runner.members))
	}
	if runner.invitation.Status != entity.InvitationStatusAccepted {
		t.Fatalf("invitation status = %q, want accepted", runner.invitation.Status)
	}
}

func TestAcceptInvitationClearsOldPermissionOverrideWhenReactivatingMembership(t *testing.T) {
	oldOverride := `["take_payment"]`
	runner := &memoryInvitationAcceptanceRunner{
		invitation: entity.Invitation{
			RestaurantID: 5,
			RoleID:       3,
			Token:        testInvitationToken,
			Status:       entity.InvitationStatusPending,
		},
		users: map[uint]entity.User{
			9: {Email: "returning@example.test", Status: "active"},
		},
		members: map[[2]uint]entity.RestaurantMember{
			{9, 5}: {
				UserID:              9,
				RestaurantID:        5,
				RoleID:              4,
				Status:              "removed",
				PermissionsOverride: &oldOverride,
			},
		},
	}
	service := &InvitationService{acceptanceTx: runner}

	member, err := service.AcceptInvitation(9, testInvitationToken)
	if err != nil {
		t.Fatalf("AcceptInvitation() error = %v", err)
	}
	if member.PermissionsOverride != nil {
		t.Fatalf("reactivated override = %q, want nil", *member.PermissionsOverride)
	}
}

func TestAcceptInvitationDoesNotReactivateSuspendedMembership(t *testing.T) {
	oldOverride := `["take_payment"]`
	runner := &memoryInvitationAcceptanceRunner{
		invitation: entity.Invitation{
			RestaurantID: 5,
			RoleID:       3,
			Token:        testInvitationToken,
			Status:       entity.InvitationStatusPending,
		},
		users: map[uint]entity.User{
			9: {Email: "suspended@example.test", Status: "active"},
		},
		members: map[[2]uint]entity.RestaurantMember{
			{9, 5}: {
				UserID:              9,
				RestaurantID:        5,
				RoleID:              4,
				Status:              "suspended",
				PermissionsOverride: &oldOverride,
			},
		},
	}
	service := &InvitationService{acceptanceTx: runner}

	if _, err := service.AcceptInvitation(9, testInvitationToken); err == nil {
		t.Fatal("AcceptInvitation() let a suspended member reactivate themself")
	}
	member := runner.members[[2]uint{9, 5}]
	if member.Status != "suspended" || member.RoleID != 4 || member.PermissionsOverride == nil {
		t.Fatalf("suspended membership was changed: %+v", member)
	}
	if runner.invitation.Status != entity.InvitationStatusPending {
		t.Fatalf("invitation status = %q, want pending (still usable by the intended person)", runner.invitation.Status)
	}
}
