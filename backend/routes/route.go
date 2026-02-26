package routes

import (
	"Project-M/internal/auth"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine){
	api := r.Group("/api")
	SetupAuthRoutes(api)

	v1 := api.Group("v1")

	v1.Use(auth.Authorizes())
	{
	}
}