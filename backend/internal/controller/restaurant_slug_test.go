package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
)

func TestRespondRestaurantSlugErrorGivesTheFormsACode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{service.ErrRestaurantSlugTaken, http.StatusConflict, "slug_taken"},
		{fmt.Errorf("update: %w", service.ErrRestaurantSlugInvalid), http.StatusBadRequest, "slug_invalid"},
	}
	for _, tc := range cases {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		if !respondRestaurantSlugError(context, tc.err) {
			t.Fatalf("respondRestaurantSlugError(%v) = false, want true", tc.err)
		}
		var body struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if recorder.Code != tc.wantStatus || body.Code != tc.wantCode {
			t.Errorf("status %d code %q, want %d %q", recorder.Code, body.Code, tc.wantStatus, tc.wantCode)
		}
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	if respondRestaurantSlugError(context, errors.New("restaurant name is required")) {
		t.Fatal("respondRestaurantSlugError claimed an unrelated error")
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("unrelated error wrote a body: %s", recorder.Body.String())
	}
}
