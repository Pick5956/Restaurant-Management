package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) FindBySutId(sutId string) (*entity.User, error) {
	var user entity.User
	if err := r.db.Where("sut_id = ?", sutId).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) FindById(id uint) (*entity.User, error) {
	var user entity.User
	if err := r.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) Create(user *entity.User) error {
	return r.db.Create(user).Error
}

func (r *UserRepository) Update(user *entity.User) error {
	return r.db.Save(user).Error
}
