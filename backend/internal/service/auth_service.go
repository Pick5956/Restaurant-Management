package service

import (
	"os"

	"Project-M/internal/auth"
	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type AuthService struct {
	userRepo *repository.UserRepository
}

func ProvideAuthService(userRepo *repository.UserRepository) *AuthService {
	return &AuthService{
		userRepo: userRepo,
	}
}

type LoginRequest struct {
	SutId    string `json:"sut_id" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token string       `json:"token"`
	User  *entity.User `json:"user"`
}

// registration

// registration now uses entity.User directly

func (s *AuthService) Register(user *entity.User) (*entity.User, error) {
	if err := user.Validation(); err != nil {
		return nil, err
	}

	// hash password
	hashed, err := auth.HashPassword(user.Password)
	if err != nil {
		return nil, err
	}
	user.Password = hashed

	// save
	if err := s.userRepo.Create(user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *AuthService) Login(req *LoginRequest) (*LoginResponse, error) {
	// ค้นหา user
	user, err := s.userRepo.FindBySutId(req.SutId)
	if err != nil {
		return nil, err
	}

	// ตรวจสอบ password
	if err := auth.VerifyPassword(user.Password, req.Password); err != nil {
		return nil, err
	}

	// สร้าง token
	jwtWrapper := &auth.JwtWrapper{
		SecretKey: os.Getenv("JWT_SECRET"),
		Issuer:    "project-management",
	}

	token, err := jwtWrapper.GenerateToken(user.ID, "user")
	if err != nil {
		return nil, err
	}

	return &LoginResponse{
		Token: token,
		User:  user,
	}, nil
}
