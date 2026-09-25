package controller

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"unicode"

	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func respondAPIError(c *gin.Context, status int, err error) {
	publicStatus, message, code := publicAPIError(status, err)
	if publicStatus >= http.StatusInternalServerError {
		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		log.Printf("request_error route=%s status=%d error_type=%T", route, publicStatus, err)
	}
	c.JSON(publicStatus, gin.H{"error": message, "code": code})
}

func respondInvalidRequest(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{
		"error": "invalid request",
		"code":  "invalid_request",
	})
}

func publicAPIError(status int, err error) (int, string, string) {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return http.StatusServiceUnavailable, "service temporarily unavailable", "service_unavailable"
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return http.StatusNotFound, "resource not found", "not_found"
	}
	if errors.Is(err, service.ErrMemberRoleUnavailable) {
		// A removed member whose role has since been deleted comes back through
		// an invitation, not a restore, so clients need to tell this refusal
		// apart from every other 400 by its code.
		return status, service.ErrMemberRoleUnavailable.Error(), "role_unavailable"
	}
	if errors.Is(err, service.ErrIngredientUnitLocked) {
		// A recipe still measures this ingredient in its current unit. Staff
		// can act on that, so clients tell it apart by its code.
		return status, service.ErrIngredientUnitLocked.Error(), "ingredient_unit_locked"
	}

	raw := ""
	if err != nil {
		raw = strings.TrimSpace(err.Error())
	}
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "sqlstate 23505") || strings.Contains(lower, "duplicate key") {
		return http.StatusConflict, "resource already exists", "conflict"
	}
	if status >= http.StatusInternalServerError || likelyInternalError(lower) {
		return http.StatusInternalServerError, "internal server error", "internal_error"
	}

	message := cleanPublicError(raw)
	if message == "" {
		message = http.StatusText(status)
	}
	return status, message, errorCodeForStatus(status)
}

func likelyInternalError(lower string) bool {
	internalMarkers := []string{
		"sqlstate ",
		"violates foreign key",
		"violates check constraint",
		"database connection",
		"connection refused",
		"dial tcp",
		"no such table",
		"syntax error at or near",
		"api_key",
		"api keys",
		"is not configured",
		"request failed with status",
		"returned http status",
		"returned empty",
		"repository is not initialized",
	}
	for _, marker := range internalMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func cleanPublicError(message string) string {
	const maxRunes = 300
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, message)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	runes := []rune(cleaned)
	if len(runes) > maxRunes {
		cleaned = string(runes[:maxRunes])
	}
	return cleaned
}

func errorCodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusTooManyRequests:
		return "rate_limited"
	default:
		return "request_failed"
	}
}
