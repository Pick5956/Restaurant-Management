package auth

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// Authorization เป็นฟังก์ชั่นตรวจเช็ค Cookie
func Authorizes() gin.HandlerFunc {
	return func(c *gin.Context) {

		clientToken := c.Request.Header.Get("Authorization")
		if clientToken == "" {
			// Try to get token from query parameter (for WebSocket)
			clientToken = c.Query("token")
		}

		if clientToken == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "No Authorization header provided"})
			return
		}

		extractedToken := strings.Split(clientToken, "Bearer ")
		if len(extractedToken) == 2 {
			clientToken = strings.TrimSpace(extractedToken[1])
		} else {
			// If not bearer format, maybe it's just the token (common in query param)
			if len(extractedToken) == 1 && c.Query("token") != "" {
				clientToken = strings.TrimSpace(extractedToken[0])
			} else {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Incorrect Format of Authorization Token"})
				return
			}
		}

		jwtWrapper := JwtWrapper{
			SecretKey: os.Getenv("JWT_SECRET"),
			Issuer:    "AuthService",
		}

		claims, err := jwtWrapper.ValidateToken(clientToken)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("user_role", claims.Role)
		c.Next()
	}
}

