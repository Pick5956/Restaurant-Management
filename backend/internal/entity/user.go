package entity

import (
	"errors"

	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	SutId        string   `json:"sut_id" gorm:"unique" binding:"required"`
	FirstName    string   `json:"first_name" binding:"required"`
	LastName     string   `json:"last_name" binding:"required"`
	Password     string   `json:"password" binding:"required"`
	NationalId   string   `json:"national_id"`
	BirthDay     string   `json:"birthday"`
	Email        string   `json:"email" binding:"required,email"`
	Address      string   `json:"address"`
	ProfileImage string   `json:"profile_image"`
	Phone        string   `json:"phone"`
	IsOnline     bool     `json:"is_online" gorm:"default:true"`
	GPAX         *float64 `json:"gpax"`
	AdvisorId    *uint    `json:"advisor_id"`
	Advisor      *User    `gorm:"foreignKey:AdvisorId" json:"advisor"`
	RoleID       uint     `json:"role_id" binding:"required"`
}

func (u *User) Validation() error {
	if u.SutId == "" {
		return errors.New("SutId is required")
	}
	if u.FirstName == "" {
		return errors.New("FirstName is required")
	}
	if u.LastName == "" {
		return errors.New("LastName is required")
	}
	if u.Password == "" {
		return errors.New("Password is required")
	}
	if u.Email == "" {
		return errors.New("Email is required")
	}
	if u.RoleID == 0 {
		return errors.New("RoleID is required")
	}
	if u.GPAX != nil && (*u.GPAX < 0.0 || *u.GPAX > 4.0) {
		return errors.New("GPAX must be between 0.0 and 4.0")
	}
	return nil
}
