package entity

import "gorm.io/gorm"

const (
	AuditActionInvitationCreated        = "invitation_created"
	AuditActionInvitationRevoked        = "invitation_revoked"
	AuditActionInvitationAccepted       = "invitation_accepted"
	AuditActionMemberStatusChanged      = "member_status_changed"
	AuditActionMemberRoleChanged        = "member_role_changed"
	AuditActionMemberPermissionsChanged = "member_permissions_changed"
	AuditActionRoleCreated              = "role_created"
	AuditActionRoleRenamed              = "role_renamed"
	AuditActionRoleDeleted              = "role_deleted"
	AuditActionRolePermissionsChanged   = "role_permissions_changed"
	AuditActionAISetMenuAvailability    = "ai_set_menu_availability"
	// AuditActionAIPlanItem is one change from an assistant plan the owner
	// confirmed — stock, cost, minimum, a new ingredient or menu, an expense.
	// Details carry the card's own title and change line.
	AuditActionAIPlanItem = "ai_action_plan_item"
)

type RestaurantAuditLog struct {
	gorm.Model
	RestaurantID uint   `json:"restaurant_id" gorm:"not null;index"`
	ActorUserID  *uint  `json:"actor_user_id" gorm:"index"`
	TargetUserID *uint  `json:"target_user_id" gorm:"index"`
	InvitationID *uint  `json:"invitation_id" gorm:"index"`
	Action       string `json:"action" gorm:"not null;index"`
	Details      string `json:"details" gorm:"type:jsonb;default:'{}'"`

	ActorUser  *User       `json:"actor_user,omitempty" gorm:"foreignKey:ActorUserID"`
	TargetUser *User       `json:"target_user,omitempty" gorm:"foreignKey:TargetUserID"`
	Invitation *Invitation `json:"invitation,omitempty" gorm:"foreignKey:InvitationID"`
}
