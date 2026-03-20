package entity

import "gorm.io/gorm"

type Role struct {
	gorm.Model
	Role string `json:"role" valid:"required~Role is required"`
	User []User `gorm:"foreignKey:RoleID" json:"user"`
}