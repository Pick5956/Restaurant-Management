package main

import (
	"Project-M/config"
	"Project-M/routes"

	"github.com/gin-gonic/gin"
)


func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PATCH, PUT, DELETE")

		//
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Type")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func main() {
	config.ConnectionDB()

	config.SetupDatabase()
	
	r := gin.Default()
	r.Use(CORSMiddleware())
	
	routes.SetupRoutes(r)
	r.Run("localhost:8080")
}