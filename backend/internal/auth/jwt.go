package auth
import (
	"time"
	"errors"

	"github.com/golang-jwt/jwt/v5"
)

type JwtWrapper struct {
	SecretKey string
	Issuer    string
}

type JwtClaims struct {
	UserID uint
	Role   string
	jwt.RegisteredClaims
}

func (j *JwtWrapper) ValidateToken(tokenString string) (*JwtClaims, error) {

	token, err := jwt.ParseWithClaims(
		tokenString,
		&JwtClaims{},
		func(token *jwt.Token) (interface{}, error) {
			return []byte(j.SecretKey), nil
		},
	)

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JwtClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}

	if claims.ExpiresAt.Time.Before(time.Now()) {
		return nil, errors.New("token expired")
	}

	return claims, nil
}

func (j *JwtWrapper) GenerateToken(userID uint, role string) (string, error) {
    now := time.Now()
    claims := &JwtClaims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            IssuedAt:  jwt.NewNumericDate(now),
            ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)), 
            Issuer:    j.Issuer,
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(j.SecretKey))
}