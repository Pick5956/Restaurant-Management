package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TestRestoringAMemberWhoseRoleIsGoneAnswersRoleUnavailable is the wire the
// web and mobile staff screens read: the member-status handler answers every
// service failure through respondAPIError with 400, and a restore refused
// because the member's role was deleted must reach the client as
// code "role_unavailable", not the generic "invalid_request".
func TestRestoringAMemberWhoseRoleIsGoneAnswersRoleUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	respondAPIError(c, http.StatusBadRequest, service.ErrMemberRoleUnavailable)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Code != "role_unavailable" {
		t.Fatalf("code = %q, want %q", body.Code, "role_unavailable")
	}
}

// TestChangingTheUnitOfAnIngredientARecipeUsesAnswersUnitLocked: the
// ingredient update handler answers every service failure with 400 through
// respondAPIError, and the unit refusal must reach the client as code
// "ingredient_unit_locked" so the app can say it in its own words.
func TestChangingTheUnitOfAnIngredientARecipeUsesAnswersUnitLocked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	respondAPIError(c, http.StatusBadRequest, service.ErrIngredientUnitLocked)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Code != "ingredient_unit_locked" {
		t.Fatalf("code = %q, want %q", body.Code, "ingredient_unit_locked")
	}
}

func TestPublicAPIError(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		err         error
		wantStatus  int
		wantMessage string
		wantCode    string
	}{
		{
			name:        "keeps a domain validation message",
			status:      http.StatusBadRequest,
			err:         errors.New("quantity must be greater than zero"),
			wantStatus:  http.StatusBadRequest,
			wantMessage: "quantity must be greater than zero",
			wantCode:    "invalid_request",
		},
		{
			name:        "maps missing records without leaking ORM text",
			status:      http.StatusBadRequest,
			err:         gorm.ErrRecordNotFound,
			wantStatus:  http.StatusNotFound,
			wantMessage: "resource not found",
			wantCode:    "not_found",
		},
		{
			name:        "hides database constraint details",
			status:      http.StatusBadRequest,
			err:         errors.New(`ERROR: duplicate key value violates unique constraint "private_constraint" (SQLSTATE 23505)`),
			wantStatus:  http.StatusConflict,
			wantMessage: "resource already exists",
			wantCode:    "conflict",
		},
		{
			name:        "hides internal errors",
			status:      http.StatusInternalServerError,
			err:         errors.New("provider returned credential-shaped diagnostics"),
			wantStatus:  http.StatusInternalServerError,
			wantMessage: "internal server error",
			wantCode:    "internal_error",
		},
		{
			name:        "hides sanitized upstream HTTP failures",
			status:      http.StatusBadRequest,
			err:         errors.New("Groq analytical request returned HTTP status 502"),
			wantStatus:  http.StatusInternalServerError,
			wantMessage: "internal server error",
			wantCode:    "internal_error",
		},
		{
			name:        "maps dependency timeout",
			status:      http.StatusInternalServerError,
			err:         context.DeadlineExceeded,
			wantStatus:  http.StatusServiceUnavailable,
			wantMessage: "service temporarily unavailable",
			wantCode:    "service_unavailable",
		},
		{
			name:        "names a deleted role on a member restore by its own code",
			status:      http.StatusBadRequest,
			err:         service.ErrMemberRoleUnavailable,
			wantStatus:  http.StatusBadRequest,
			wantMessage: "role is not available for this restaurant",
			wantCode:    "role_unavailable",
		},
		{
			name:        "keeps the role code through a wrapped error",
			status:      http.StatusBadRequest,
			err:         fmt.Errorf("restore member: %w", service.ErrMemberRoleUnavailable),
			wantStatus:  http.StatusBadRequest,
			wantMessage: "role is not available for this restaurant",
			wantCode:    "role_unavailable",
		},
		{
			name:        "names a unit change on an ingredient a recipe uses by its own code",
			status:      http.StatusBadRequest,
			err:         service.ErrIngredientUnitLocked,
			wantStatus:  http.StatusBadRequest,
			wantMessage: "cannot change stock units while ingredient is used by a menu recipe",
			wantCode:    "ingredient_unit_locked",
		},
		{
			name:        "keeps the unit-locked code through a wrapped error",
			status:      http.StatusBadRequest,
			err:         fmt.Errorf("update ingredient: %w", service.ErrIngredientUnitLocked),
			wantStatus:  http.StatusBadRequest,
			wantMessage: "cannot change stock units while ingredient is used by a menu recipe",
			wantCode:    "ingredient_unit_locked",
		},
		{
			name:        "the same words without the sentinel stay a plain refusal",
			status:      http.StatusBadRequest,
			err:         errors.New("cannot change stock units while ingredient is used by a menu recipe"),
			wantStatus:  http.StatusBadRequest,
			wantMessage: "cannot change stock units while ingredient is used by a menu recipe",
			wantCode:    "invalid_request",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status, message, code := publicAPIError(test.status, test.err)
			if status != test.wantStatus || message != test.wantMessage || code != test.wantCode {
				t.Fatalf(
					"publicAPIError() = (%d, %q, %q), want (%d, %q, %q)",
					status,
					message,
					code,
					test.wantStatus,
					test.wantMessage,
					test.wantCode,
				)
			}
		})
	}
}
