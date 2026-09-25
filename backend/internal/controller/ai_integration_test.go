package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
)

type fakeAIOperationsService struct {
	askResponse       *service.AIAskResponse
	askErr            error
	snapshotResponse  *service.AISnapshot
	snapshotErr       error
	askCalls          int
	snapshotCalls     int
	restaurantID      uint
	actor             service.AIActorContext
	request           *service.AIAskRequest
	deleteCalls       int
	deletedID         string
	usageResponse     *service.AIUsageSnapshot
	usageCalls        int
	confirmResponse   *service.AIActionConfirmationResponse
	confirmErr        error
	confirmCalls      int
	previewID         string
	confirmationToken string
	cancelErr         error
	cancelCalls       int
	cancelledID       string
}

func (f *fakeAIOperationsService) AskOperationsForOwner(_ context.Context, actor service.AIActorContext, req *service.AIAskRequest) (*service.AIAskResponse, error) {
	f.askCalls++
	f.actor = actor
	f.restaurantID = actor.RestaurantID
	f.request = req
	return f.askResponse, f.askErr
}

func (f *fakeAIOperationsService) OperationsSnapshot(restaurantID uint) (*service.AISnapshot, error) {
	f.snapshotCalls++
	f.restaurantID = restaurantID
	return f.snapshotResponse, f.snapshotErr
}

func (f *fakeAIOperationsService) DeleteConversationForOwner(actor service.AIActorContext, conversationID string) error {
	f.deleteCalls++
	f.actor = actor
	f.deletedID = conversationID
	return f.askErr
}

func (f *fakeAIOperationsService) AIUsageForOwner(actor service.AIActorContext) (*service.AIUsageSnapshot, error) {
	f.usageCalls++
	f.actor = actor
	return f.usageResponse, f.askErr
}

func (f *fakeAIOperationsService) ProactiveInsightsForOwner(actor service.AIActorContext) ([]service.AIInsight, error) {
	f.actor = actor
	return nil, f.askErr
}

func (f *fakeAIOperationsService) ExtractReceiptForOwner(actor service.AIActorContext, _ string, _ string) (*service.ReceiptDraft, error) {
	f.actor = actor
	return nil, f.askErr
}

func (f *fakeAIOperationsService) TranscribeForOwner(actor service.AIActorContext, _ string, _ string, _ string) (string, error) {
	f.actor = actor
	return "", f.askErr
}

func (f *fakeAIOperationsService) AIActionsSettingForOwner(uint) (service.AIActionsSettingView, error) {
	return service.AIActionsSettingView{}, f.askErr
}

func (f *fakeAIOperationsService) ListConversationsForOwner(service.AIActorContext, bool, int) ([]repository.AIConversationSummary, error) {
	return nil, nil
}

func (f *fakeAIOperationsService) ConversationTurnsForOwner(service.AIActorContext, string, uint64, int) ([]service.AIConversationTurnView, error) {
	return nil, nil
}

func (f *fakeAIOperationsService) RenameConversationForOwner(service.AIActorContext, string, string) error {
	return nil
}

func (f *fakeAIOperationsService) RestoreConversationForOwner(service.AIActorContext, string) error {
	return nil
}

func (f *fakeAIOperationsService) PurgeConversationForOwner(service.AIActorContext, string) error {
	return nil
}

func (f *fakeAIOperationsService) PurgeAllTrashedForOwner(service.AIActorContext) (int64, error) {
	return 0, nil
}

func (f *fakeAIOperationsService) ApplyAISettingsPatchForOwner(uint, service.AISettingsPatch) error {
	return nil
}

func (f *fakeAIOperationsService) DeleteAllConversationsForOwner(service.AIActorContext) (int64, error) {
	return 0, nil
}

func (f *fakeAIOperationsService) SetAIActionsSettingForOwner(uint, bool) error {
	return f.askErr
}

func (f *fakeAIOperationsService) ConfirmAIActionPlanForOwner(service.AIActorContext, string, string) (*service.AIActionPlanConfirmation, error) {
	return &service.AIActionPlanConfirmation{}, f.askErr
}

func (f *fakeAIOperationsService) SetupAIPlanIngredientForOwner(service.AIActorContext, string, int, service.AIIngredientSetupRequest) (*service.AIActionPlanResponse, error) {
	return &service.AIActionPlanResponse{}, f.askErr
}

func (f *fakeAIOperationsService) CancelAIActionPlanForOwner(service.AIActorContext, string) error {
	return f.askErr
}

func (f *fakeAIOperationsService) ConfirmAIActionForOwner(actor service.AIActorContext, previewID, confirmationToken string) (*service.AIActionConfirmationResponse, error) {
	f.confirmCalls++
	f.actor = actor
	f.previewID = previewID
	f.confirmationToken = confirmationToken
	return f.confirmResponse, f.confirmErr
}

func (f *fakeAIOperationsService) CancelAIActionForOwner(actor service.AIActorContext, previewID string) error {
	f.cancelCalls++
	f.actor = actor
	f.cancelledID = previewID
	return f.cancelErr
}

func testAIRouter(svc AIOperationsService, member *entity.RestaurantMember, includeRestaurant bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	ctrl := NewAIController(svc)
	router.Use(func(c *gin.Context) {
		if includeRestaurant {
			c.Set("restaurant_id", uint(12))
		}
		if member != nil {
			c.Set("restaurant_member", member)
			c.Set("user_id", uint(99))
		}
		c.Next()
	})
	router.POST("/ai/operations/ask", ctrl.AskOperations)
	router.GET("/ai/operations/snapshot", ctrl.OperationsSnapshot)
	router.GET("/ai/operations/metrics", ctrl.UsageMetrics)
	router.POST("/ai/operations/actions/:previewID/confirm", ctrl.ConfirmAction)
	router.DELETE("/ai/operations/actions/:previewID", ctrl.CancelAction)
	router.DELETE("/ai/operations/conversations/:conversationID", ctrl.DeleteConversation)
	return router
}

func TestCancelAIActionUsesOwnerScopeWithoutAConfirmationToken(t *testing.T) {
	svc := &fakeAIOperationsService{}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/ai/operations/actions/preview-123", nil))

	if recorder.Code != http.StatusNoContent || recorder.Body.Len() != 0 {
		t.Fatalf("CancelAction status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if svc.cancelCalls != 1 || svc.cancelledID != "preview-123" || svc.actor.RestaurantID != 12 || svc.actor.OwnerUserID != 99 || svc.actor.Role != "owner" {
		t.Fatalf("CancelAction scope = calls %d id %q actor %+v", svc.cancelCalls, svc.cancelledID, svc.actor)
	}
	if recorder.Header().Get("Cache-Control") != "no-store, private" {
		t.Fatalf("CancelAction cache policy = %q", recorder.Header().Get("Cache-Control"))
	}
}

func TestCancelAIActionRejectsNonOwnerAndMapsSafeErrors(t *testing.T) {
	t.Run("non-owner", func(t *testing.T) {
		svc := &fakeAIOperationsService{}
		router := testAIRouter(svc, memberWithRole("manager", `["view_reports"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/ai/operations/actions/preview-1", nil))

		if recorder.Code != http.StatusForbidden || svc.cancelCalls != 0 {
			t.Fatalf("non-owner cancel status=%d calls=%d", recorder.Code, svc.cancelCalls)
		}
	})

	for name, testCase := range map[string]struct {
		err    error
		status int
	}{
		"missing":  {err: repository.ErrAIActionPreviewNotFound, status: http.StatusNotFound},
		"expired":  {err: repository.ErrAIActionPreviewExpired, status: http.StatusGone},
		"executed": {err: repository.ErrAIActionPreviewAlreadyExecuted, status: http.StatusConflict},
	} {
		t.Run(name, func(t *testing.T) {
			svc := &fakeAIOperationsService{cancelErr: testCase.err}
			router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/ai/operations/actions/preview-1", nil))

			if recorder.Code != testCase.status || svc.cancelCalls != 1 {
				t.Fatalf("cancel status=%d want=%d calls=%d", recorder.Code, testCase.status, svc.cancelCalls)
			}
		})
	}
}

func memberWithRole(name, permissions string) *entity.RestaurantMember {
	return &entity.RestaurantMember{Role: &entity.Role{Name: name, Permissions: permissions}}
}

func TestAskOperationsRequiresRestaurantContext(t *testing.T) {
	svc := &fakeAIOperationsService{}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), false)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"hello"}`)))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("AskOperations without restaurant context status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if svc.askCalls != 0 {
		t.Fatal("AskOperations must not reach the service without restaurant context")
	}
}

func TestAskOperationsRejectsNonOwner(t *testing.T) {
	for _, role := range []string{"manager", "waiter"} {
		t.Run(role, func(t *testing.T) {
			svc := &fakeAIOperationsService{}
			router := testAIRouter(svc, memberWithRole(role, `["view_reports","manage_inventory"]`), true)
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"ยอดขายวันนี้"}`)))

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("AskOperations for %s status = %d, want %d", role, recorder.Code, http.StatusForbidden)
			}
			if svc.askCalls != 0 {
				t.Fatal("AskOperations must not reach the service for a non-owner")
			}
		})
	}
}

func TestAskOperationsReturnsServiceResponseSchema(t *testing.T) {
	svc := &fakeAIOperationsService{
		askResponse: &service.AIAskResponse{
			Answer: "ผมยังไม่เข้าใจคำขอนี้ครับ",
			Intent: service.AIIntentUnclear,
			Model:  "fake-router",
			Snapshot: service.AISnapshot{
				GeneratedAt: "2026-05-26T17:00:00+07:00",
			},
		},
	}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"rytyt","history":[{"role":"user","content":"menu"}]}`)))

	if recorder.Code != http.StatusOK {
		t.Fatalf("AskOperations success status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "no-store") {
		t.Fatalf("AskOperations Cache-Control = %q, want no-store", cacheControl)
	}
	if svc.restaurantID != 12 || svc.actor.OwnerUserID != 99 || svc.actor.Role != "owner" || svc.request == nil || svc.request.Question != "rytyt" || len(svc.request.History) != 1 {
		t.Fatalf("AskOperations did not forward the scoped request correctly: restaurant=%d request=%+v", svc.restaurantID, svc.request)
	}
	var response service.AIAskResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode AskOperations response: %v", err)
	}
	if response.Intent != service.AIIntentUnclear || response.Model != "fake-router" || response.Answer == "" {
		t.Fatalf("AskOperations response = %+v, want unclear response contract", response)
	}
}

func TestDeleteAIConversationUsesOwnerAndRestaurantScope(t *testing.T) {
	svc := &fakeAIOperationsService{}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/ai/operations/conversations/conversation-123", nil))

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("DeleteConversation status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if svc.deleteCalls != 1 || svc.deletedID != "conversation-123" || svc.actor.RestaurantID != 12 || svc.actor.OwnerUserID != 99 || svc.actor.Role != "owner" {
		t.Fatalf("DeleteConversation scope = calls %d id %q actor %+v", svc.deleteCalls, svc.deletedID, svc.actor)
	}
}

func TestAIUsageMetricsUsesOwnerAndRestaurantScope(t *testing.T) {
	svc := &fakeAIOperationsService{usageResponse: &service.AIUsageSnapshot{Enabled: true, PlannerRequests: 3}}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ai/operations/metrics", nil))

	if recorder.Code != http.StatusOK || svc.usageCalls != 1 {
		t.Fatalf("UsageMetrics status=%d calls=%d", recorder.Code, svc.usageCalls)
	}
	if svc.actor.RestaurantID != 12 || svc.actor.OwnerUserID != 99 || svc.actor.Role != "owner" {
		t.Fatalf("UsageMetrics actor = %+v", svc.actor)
	}
}

func TestConfirmAIActionUsesOwnerScopeAndDoesNotEchoToken(t *testing.T) {
	svc := &fakeAIOperationsService{confirmResponse: &service.AIActionConfirmationResponse{
		ActionID: "preview-123",
		Status:   entity.AIActionPreviewStatusExecuted,
		Result: service.AIActionConfirmationResult{
			MenuItemID:  42,
			Name:        "Pad Thai",
			IsAvailable: false,
		},
	}}
	router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodPost,
		"/ai/operations/actions/preview-123/confirm",
		strings.NewReader(`{"confirmation_token":"one-time-secret"}`),
	))

	if recorder.Code != http.StatusOK {
		t.Fatalf("ConfirmAction status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if svc.confirmCalls != 1 || svc.previewID != "preview-123" || svc.confirmationToken != "one-time-secret" {
		t.Fatalf("ConfirmAction forwarding = calls %d id %q token %q", svc.confirmCalls, svc.previewID, svc.confirmationToken)
	}
	if svc.actor.RestaurantID != 12 || svc.actor.OwnerUserID != 99 || svc.actor.Role != "owner" {
		t.Fatalf("ConfirmAction actor = %+v", svc.actor)
	}
	if strings.Contains(recorder.Body.String(), "one-time-secret") {
		t.Fatal("confirmation response echoed the one-time token")
	}
}

func TestConfirmAIActionRejectsNonOwnerAndMapsSafeErrors(t *testing.T) {
	t.Run("non-owner", func(t *testing.T) {
		svc := &fakeAIOperationsService{}
		router := testAIRouter(svc, memberWithRole("manager", `[]`), true)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(
			http.MethodPost,
			"/ai/operations/actions/preview-1/confirm",
			strings.NewReader(`{"confirmation_token":"token"}`),
		))
		if recorder.Code != http.StatusForbidden || svc.confirmCalls != 0 {
			t.Fatalf("non-owner confirm status=%d calls=%d", recorder.Code, svc.confirmCalls)
		}
	})
	t.Run("unknown body field", func(t *testing.T) {
		svc := &fakeAIOperationsService{}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(
			http.MethodPost,
			"/ai/operations/actions/preview-1/confirm",
			strings.NewReader(`{"confirmation_token":"token","is_available":true}`),
		))
		if recorder.Code != http.StatusBadRequest || svc.confirmCalls != 0 {
			t.Fatalf("unknown confirm field status=%d calls=%d", recorder.Code, svc.confirmCalls)
		}
	})
	t.Run("invalid preview id", func(t *testing.T) {
		svc := &fakeAIOperationsService{}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(
			http.MethodPost,
			"/ai/operations/actions/bad.id/confirm",
			strings.NewReader(`{"confirmation_token":"token"}`),
		))
		if recorder.Code != http.StatusBadRequest || svc.confirmCalls != 0 {
			t.Fatalf("invalid preview id status=%d calls=%d", recorder.Code, svc.confirmCalls)
		}
	})

	for name, testCase := range map[string]struct {
		err    error
		status int
	}{
		"disabled":      {service.ErrAIActionsDisabled, http.StatusForbidden},
		"invalid token": {repository.ErrAIActionPreviewInvalidToken, http.StatusForbidden},
		"not found":     {repository.ErrAIActionPreviewNotFound, http.StatusNotFound},
		"expired":       {repository.ErrAIActionPreviewExpired, http.StatusGone},
		"stale":         {repository.ErrAIActionPreviewStale, http.StatusConflict},
	} {
		t.Run(name, func(t *testing.T) {
			svc := &fakeAIOperationsService{confirmErr: testCase.err}
			router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(
				http.MethodPost,
				"/ai/operations/actions/preview-1/confirm",
				strings.NewReader(`{"confirmation_token":"token"}`),
			))
			if recorder.Code != testCase.status {
				t.Fatalf("ConfirmAction status=%d want=%d body=%s", recorder.Code, testCase.status, recorder.Body.String())
			}
		})
	}
}

func TestAskOperationsReturnsBadRequestForInvalidBodyAndServiceError(t *testing.T) {
	t.Run("invalid json", func(t *testing.T) {
		svc := &fakeAIOperationsService{}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{`)))

		if recorder.Code != http.StatusBadRequest || svc.askCalls != 0 {
			t.Fatalf("invalid JSON status=%d askCalls=%d, want bad request without service call", recorder.Code, svc.askCalls)
		}
	})

	t.Run("service error", func(t *testing.T) {
		svc := &fakeAIOperationsService{askErr: errors.New("provider unavailable")}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"สรุปยอดขาย"}`)))

		if recorder.Code != http.StatusBadRequest || svc.askCalls != 1 {
			t.Fatalf("service error status=%d askCalls=%d, want bad request after one service call", recorder.Code, svc.askCalls)
		}
	})

	t.Run("conversation conflict", func(t *testing.T) {
		svc := &fakeAIOperationsService{askErr: repository.ErrAIConversationConflict}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"ยอดขายวันนี้"}`)))

		if recorder.Code != http.StatusConflict || svc.askCalls != 1 {
			t.Fatalf("conversation conflict status=%d askCalls=%d, want conflict", recorder.Code, svc.askCalls)
		}
	})

	t.Run("conversation persistence failure", func(t *testing.T) {
		svc := &fakeAIOperationsService{askErr: service.ErrAIConversationPersistence}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"ยอดขายวันนี้"}`)))

		if recorder.Code != http.StatusInternalServerError || svc.askCalls != 1 {
			t.Fatalf("conversation persistence status=%d askCalls=%d, want internal server error", recorder.Code, svc.askCalls)
		}
	})

	t.Run("daily AI quota", func(t *testing.T) {
		svc := &fakeAIOperationsService{askErr: service.ErrAIQuotaExceeded}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/ai/operations/ask", strings.NewReader(`{"question":"ยอดขายวันนี้"}`)))

		if recorder.Code != http.StatusTooManyRequests || svc.askCalls != 1 {
			t.Fatalf("quota status=%d askCalls=%d, want too many requests", recorder.Code, svc.askCalls)
		}
	})
}

func TestOperationsSnapshotReturnsPayloadAndMapsServiceFailure(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc := &fakeAIOperationsService{snapshotResponse: &service.AISnapshot{GeneratedAt: "2026-05-26T17:00:00+07:00"}}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ai/operations/snapshot", nil))

		if recorder.Code != http.StatusOK || svc.snapshotCalls != 1 || svc.restaurantID != 12 {
			t.Fatalf("snapshot success status=%d calls=%d restaurant=%d", recorder.Code, svc.snapshotCalls, svc.restaurantID)
		}
	})

	t.Run("service error", func(t *testing.T) {
		svc := &fakeAIOperationsService{snapshotErr: errors.New("snapshot unavailable")}
		router := testAIRouter(svc, memberWithRole("owner", `["*"]`), true)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ai/operations/snapshot", nil))

		if recorder.Code != http.StatusInternalServerError || svc.snapshotCalls != 1 {
			t.Fatalf("snapshot error status=%d calls=%d, want internal server error", recorder.Code, svc.snapshotCalls)
		}
	})
}
