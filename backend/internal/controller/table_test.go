package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
)

// A table in service is refused with 409 and the fixed text on every
// management endpoint; the web and the app match that text. Any other error
// keeps the status its endpoint always used.
func TestTableInUseIsAConflictWithAFixedMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, fallback := range []int{http.StatusBadRequest, http.StatusConflict} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		respondAPIError(context, tableManagementErrorStatus(service.ErrTableInUse, fallback), service.ErrTableInUse)

		if recorder.Code != http.StatusConflict {
			t.Fatalf("fallback %d: status = %d, want %d", fallback, recorder.Code, http.StatusConflict)
		}
		var response struct {
			Code  string `json:"code"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if response.Error != "table is in use" || response.Code != "conflict" {
			t.Fatalf("body = %+v, want error %q code %q", response, "table is in use", "conflict")
		}
	}

	other := errors.New("capacity must be between 1 and 50")
	if got := tableManagementErrorStatus(other, http.StatusBadRequest); got != http.StatusBadRequest {
		t.Fatalf("other error status = %d, want %d", got, http.StatusBadRequest)
	}
}

func TestLegacySeatReservationEndpointIsGoneWithoutCallingTableService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/v1/tables/23/seat-reservation", nil)
	context.Params = gin.Params{{Key: "id", Value: "23"}}
	context.Set("restaurant_id", uint(7))
	context.Set("restaurant_member", &entity.RestaurantMember{
		Role: &entity.Role{Name: "custom", Permissions: `["take_order"]`},
	})

	// A nil service is intentional: this regression test proves the retired
	// endpoint returns before it can invoke any table mutation.
	controller := &TableController{}
	controller.SeatReservation(context)

	if recorder.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGone)
	}
	var response struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Code != "legacy_seat_reservation_retired" {
		t.Fatalf("code = %q, want legacy_seat_reservation_retired", response.Code)
	}
	if response.Error == "" {
		t.Fatal("error message must explain the supported seating path")
	}
}
