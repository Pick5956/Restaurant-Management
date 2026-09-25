package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

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
