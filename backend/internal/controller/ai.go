package controller

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"log"
	"sync"

	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AIController struct {
	svc AIOperationsService
}

type AIOperationsService interface {
	AskOperationsForOwner(ctx context.Context, actor service.AIActorContext, req *service.AIAskRequest) (*service.AIAskResponse, error)
	OperationsSnapshot(restaurantID uint) (*service.AISnapshot, error)
	DeleteConversationForOwner(actor service.AIActorContext, conversationID string) error
	ListConversationsForOwner(actor service.AIActorContext, trashed bool, limit int) ([]repository.AIConversationSummary, error)
	ConversationTurnsForOwner(actor service.AIActorContext, conversationID string, beforeSequence uint64, limit int) ([]service.AIConversationTurnView, error)
	RenameConversationForOwner(actor service.AIActorContext, conversationID, title string) error
	RestoreConversationForOwner(actor service.AIActorContext, conversationID string) error
	PurgeConversationForOwner(actor service.AIActorContext, conversationID string) error
	PurgeAllTrashedForOwner(actor service.AIActorContext) (int64, error)
	AIUsageForOwner(actor service.AIActorContext) (*service.AIUsageSnapshot, error)
	ProactiveInsightsForOwner(actor service.AIActorContext) ([]service.AIInsight, error)
	ExtractReceiptForOwner(actor service.AIActorContext, imageBase64, mimeType string) (*service.ReceiptDraft, error)
	TranscribeForOwner(actor service.AIActorContext, audioBase64, mimeType, language string) (string, error)
	ConfirmAIActionForOwner(actor service.AIActorContext, previewID, confirmationToken string) (*service.AIActionConfirmationResponse, error)
	CancelAIActionForOwner(actor service.AIActorContext, previewID string) error
	AIActionsSettingForOwner(restaurantID uint) (service.AIActionsSettingView, error)
	SetAIActionsSettingForOwner(restaurantID uint, enabled bool) error
	ApplyAISettingsPatchForOwner(restaurantID uint, patch service.AISettingsPatch) error
	DeleteAllConversationsForOwner(actor service.AIActorContext) (int64, error)
	ConfirmAIActionPlanForOwner(actor service.AIActorContext, planID, confirmationToken string) (*service.AIActionPlanConfirmation, error)
	SetupAIPlanIngredientForOwner(actor service.AIActorContext, planID string, seq int, request service.AIIngredientSetupRequest) (*service.AIActionPlanResponse, error)
	CancelAIActionPlanForOwner(actor service.AIActorContext, planID string) error
}

const maxAIActionConfirmationBodyBytes int64 = 1024

// A 1.5 MB image is ~2 MB of base64 plus JSON overhead. Capping here stops an
// oversized upload before it is parsed, instead of leaning on the global 8 MB limit.
const maxReceiptRequestBodyBytes int64 = 3 << 20

// Base64 inflates by a third, so the body cap sits above the audio cap.
const maxTranscribeRequestBodyBytes int64 = 9 << 20

func requireAIOwner(c *gin.Context) bool {
	member, ok := contextMember(c)
	if !ok || member.Role == nil || member.Role.Name != "owner" {
		c.JSON(http.StatusForbidden, gin.H{"error": "AI operations are available to the restaurant owner only"})
		return false
	}
	return true
}

func ProvideAIController(db *gorm.DB) *AIController {
	return NewAIController(service.ProvideAIServiceWithStores(
		repository.NewAIRepository(db),
		repository.NewAIConversationRepository(db),
		repository.NewAIActionPreviewRepository(db),
		repository.NewMenuRepository(db),
		repository.NewAIActionPlanRepository(db),
		service.ProvideIngredientService(repository.NewIngredientRepository(db)),
		// The same menu service the menu screen uses, so an availability change the
		// assistant makes runs exactly the code a button press runs.
		service.ProvideMenuService(repository.NewMenuRepository(db)),
		service.ProvideExpenseService(repository.NewExpenseRepository(db)),
		// Read-only: the assistant reports the floor, it does not book tables.
		service.ProvideTableService(repository.NewTableRepository(db)),
	))
}

func NewAIController(svc AIOperationsService) *AIController {
	return &AIController{svc: svc}
}

func (ctrl *AIController) AskOperations(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	var req service.AIAskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	actor := service.AIActorContext{RestaurantID: restaurantID, OwnerUserID: userID, Role: "owner"}
	// Ask responses can contain a one-time action confirmation token and always
	// contain private restaurant data. Do not let browsers or intermediary
	// caches retain either the JSON response or the event stream.
	c.Header("Cache-Control", "no-store, private")
	c.Header("Pragma", "no-cache")

	if c.Query("stream") == "true" {
		ctrl.askStreaming(c, actor, &req)
		return
	}
	result, err := ctrl.svc.AskOperationsForOwner(c.Request.Context(), actor, &req)
	if err != nil {
		status, body := askErrorResponse(c, err)
		c.JSON(status, body)
		return
	}
	c.JSON(http.StatusOK, result)
}

// askStreaming answers over server-sent events so the owner reads the answer
// while it is being written. Three event kinds, in this order:
//
//	draft  {"text": "..."}   the answer so far, cleaned, sent as it grows
//	answer {AIAskResponse}   the finished response, replacing every draft
//	error  {"error","code"}  what a plain call would have returned, plus
//	                         "status" with the HTTP status it would have carried
//
// The stream is 200 from the first byte, so the outcome rides in the last
// event. Drafts come from the model's goroutine; the one writer lock keeps
// events whole.
func (ctrl *AIController) askStreaming(c *gin.Context, actor service.AIActorContext, req *service.AIAskRequest) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	var mu sync.Mutex
	send := func(event string, payload any) {
		mu.Lock()
		defer mu.Unlock()
		c.SSEvent(event, payload)
		c.Writer.Flush()
	}
	req.OnDraft = func(text string) { send("draft", gin.H{"text": text}) }
	result, err := ctrl.svc.AskOperationsForOwner(c.Request.Context(), actor, req)
	if err != nil {
		status, body := askErrorResponse(c, err)
		body["status"] = status
		send("error", body)
		return
	}
	send("answer", result)
}

// askErrorResponse is the one mapping from an ask failure to what the client
// sees, shared by the JSON and the streamed route. An outage is reported as
// an outage: the assistant can still read the database without a provider,
// and answering from it anyway would hide the failure behind something that
// looks like an ordinary answer — the owner could not tell the two apart, nor
// know the day's budget was gone. 429 says come back later and when; 503 says
// the provider is out, not the budget.
func askErrorResponse(c *gin.Context, err error) (int, gin.H) {
	if errors.Is(err, service.ErrAIQuotaExceeded) {
		return http.StatusTooManyRequests, aiOutageBody(c, "ai_quota_exceeded", err)
	}
	if errors.Is(err, service.ErrAIProviderUnavailable) {
		return http.StatusServiceUnavailable, aiOutageBody(c, "ai_provider_unavailable", err)
	}
	if errors.Is(err, repository.ErrAIConversationConflict) {
		return publicErrorBody(c, http.StatusConflict, err)
	}
	// A chat that was trashed or purged under the screen: its own code, so the
	// screen opens a fresh chat instead of showing a failure.
	if errors.Is(err, service.ErrAIConversationGone) {
		return http.StatusNotFound, gin.H{"error": "conversation is gone", "code": "conversation_gone"}
	}
	if errors.Is(err, service.ErrAIConversationPersistence) {
		return publicErrorBody(c, http.StatusInternalServerError, err)
	}
	return publicErrorBody(c, http.StatusBadRequest, err)
}

// publicErrorBody is respondAPIError's body without the write, for callers
// that send it themselves.
func publicErrorBody(c *gin.Context, status int, err error) (int, gin.H) {
	publicStatus, message, code := publicAPIError(status, err)
	if publicStatus >= http.StatusInternalServerError {
		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		log.Printf("request_error route=%s status=%d error_type=%T", route, publicStatus, err)
	}
	return publicStatus, gin.H{"error": message, "code": code}
}

// aiOutageBody is respondAIOutage's body; the Retry-After header goes with it
// on the JSON route only, where headers can still be set.
func aiOutageBody(c *gin.Context, code string, err error) gin.H {
	body := gin.H{"error": err.Error(), "code": code}
	if seconds := service.AIRetryAfterSeconds(err); seconds > 0 {
		body["retry_after_seconds"] = seconds
		if !c.Writer.Written() {
			c.Header("Retry-After", strconv.Itoa(seconds))
		}
	}
	return body
}

func (ctrl *AIController) ProactiveInsights(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	insights, err := ctrl.svc.ProactiveInsightsForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	})
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"insights": insights})
}

// ConfirmAIActionPlan runs a multi-item plan the owner just confirmed. The
// per-item outcome is returned as-is, so a batch that partly failed is reported
// rather than rounded up to success.
func (ctrl *AIController) ConfirmAIActionPlan(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAIActionConfirmationBodyBytes)
	var input service.AIActionConfirmationRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.ConfirmAIActionPlanForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, c.Param("planID"), input.ConfirmationToken)
	if err != nil {
		respondAIActionPlanError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store, private")
	c.JSON(http.StatusOK, result)
}

// SetupAIPlanIngredient applies one answer from the new-ingredient card (its
// unit, pack size, price) to a pending plan and returns the card redrawn.
func (ctrl *AIController) SetupAIPlanIngredient(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil || seq < 0 {
		respondInvalidRequest(c)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAIActionConfirmationBodyBytes)
	var input service.AIIngredientSetupRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.SetupAIPlanIngredientForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, c.Param("planID"), seq, input)
	if err != nil {
		respondAIActionPlanError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store, private")
	c.JSON(http.StatusOK, result)
}

// CancelAIActionPlan drops a pending plan without writing anything.
func (ctrl *AIController) CancelAIActionPlan(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	if err := ctrl.svc.CancelAIActionPlanForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, c.Param("planID")); err != nil {
		respondAIActionPlanError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// respondAIActionPlanError maps the boundary's refusals to status codes the
// client can act on: gone for a window that closed, conflict for a race.
func respondAIActionPlanError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrAIActionPlanNotFound):
		respondAPIError(c, http.StatusNotFound, err)
	case errors.Is(err, repository.ErrAIActionPlanInvalidToken):
		respondAPIError(c, http.StatusForbidden, err)
	case errors.Is(err, repository.ErrAIActionPlanExpired), errors.Is(err, repository.ErrAIActionPlanCancelled):
		respondAPIError(c, http.StatusGone, err)
	case errors.Is(err, repository.ErrAIActionPlanInProgress), errors.Is(err, repository.ErrAIActionPlanAlreadyExecuted):
		respondAPIError(c, http.StatusConflict, err)
	case errors.Is(err, service.ErrAIActionsDisabled), errors.Is(err, service.ErrAIActionUnavailable):
		respondAPIError(c, http.StatusForbidden, err)
	default:
		respondAPIError(c, http.StatusBadRequest, err)
	}
}

// GetAISettings returns the owner-facing AI settings (whether the assistant may
// make changes).
func (ctrl *AIController) GetAISettings(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	view, err := ctrl.svc.AIActionsSettingForOwner(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// UpdateAISettings stores the owner's choice of whether the assistant may make
// (previewed, confirmed) changes.
func (ctrl *AIController) UpdateAISettings(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	// Every field is optional: the settings screen saves each switch as it is
	// flipped, and a save carries only what changed.
	var patch service.AISettingsPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	if err := ctrl.svc.ApplyAISettingsPatchForOwner(restaurantID, patch); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	view, err := ctrl.svc.AIActionsSettingForOwner(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// ExtractReceipt reads a bill photo into a draft expense (owner reviews before saving).
func (ctrl *AIController) ExtractReceipt(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	var req struct {
		Image    string `json:"image"`
		MimeType string `json:"mime_type"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxReceiptRequestBodyBytes)
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	draft, err := ctrl.svc.ExtractReceiptForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, req.Image, req.MimeType)
	if err != nil {
		if errors.Is(err, service.ErrAIQuotaExceeded) {
			respondAPIError(c, http.StatusTooManyRequests, err)
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"draft": draft})
}

// Transcribe turns a short voice note into text for the composer. Nothing is
// asked or saved here — the owner reads what was heard and edits it first.
func (ctrl *AIController) Transcribe(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	var req struct {
		Audio    string `json:"audio"`
		MimeType string `json:"mime_type"`
		Language string `json:"language"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTranscribeRequestBodyBytes)
	if err := c.ShouldBindJSON(&req); err != nil {
		respondInvalidRequest(c)
		return
	}
	text, err := ctrl.svc.TranscribeForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, req.Audio, req.MimeType, req.Language)
	if err != nil {
		if errors.Is(err, service.ErrAIQuotaExceeded) {
			respondAPIError(c, http.StatusTooManyRequests, err)
			return
		}
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"text": text})
}

func (ctrl *AIController) UsageMetrics(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	result, err := ctrl.svc.AIUsageForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	})
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (ctrl *AIController) ConfirmAction(c *gin.Context) {
	c.Header("Cache-Control", "no-store, private")
	c.Header("Pragma", "no-cache")
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	previewID := strings.TrimSpace(c.Param("previewID"))
	if !validAIActionPreviewID(previewID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI action preview id"})
		return
	}
	var req service.AIActionConfirmationRequest
	if err := decodeAIActionConfirmationRequest(c, &req); err != nil {
		respondInvalidRequest(c)
		return
	}
	result, err := ctrl.svc.ConfirmAIActionForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, previewID, req.ConfirmationToken)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAIActionsDisabled):
			respondAPIError(c, http.StatusForbidden, err)
		case errors.Is(err, service.ErrAIActionUnavailable):
			respondAPIError(c, http.StatusServiceUnavailable, err)
		case errors.Is(err, repository.ErrAIActionPreviewNotFound):
			respondAPIError(c, http.StatusNotFound, err)
		case errors.Is(err, repository.ErrAIActionPreviewInvalidToken):
			respondAPIError(c, http.StatusForbidden, err)
		case errors.Is(err, repository.ErrAIActionPreviewExpired):
			respondAPIError(c, http.StatusGone, err)
		case errors.Is(err, repository.ErrAIActionPreviewStale),
			errors.Is(err, repository.ErrAIActionPreviewCancelled),
			errors.Is(err, repository.ErrAIActionPreviewAlreadyExecuted),
			errors.Is(err, repository.ErrAIActionPreviewInvalidState):
			respondAPIError(c, http.StatusConflict, err)
		default:
			respondAPIError(c, http.StatusInternalServerError, err)
		}
		return
	}
	c.JSON(http.StatusOK, result)
}

func (ctrl *AIController) CancelAction(c *gin.Context) {
	c.Header("Cache-Control", "no-store, private")
	c.Header("Pragma", "no-cache")
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	previewID := strings.TrimSpace(c.Param("previewID"))
	if !validAIActionPreviewID(previewID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI action preview id"})
		return
	}

	err := ctrl.svc.CancelAIActionForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, previewID)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrAIActionPreviewCancelled):
			c.Status(http.StatusNoContent)
		case errors.Is(err, service.ErrAIActionUnavailable):
			respondAPIError(c, http.StatusServiceUnavailable, err)
		case errors.Is(err, repository.ErrAIActionPreviewNotFound):
			respondAPIError(c, http.StatusNotFound, err)
		case errors.Is(err, repository.ErrAIActionPreviewExpired):
			respondAPIError(c, http.StatusGone, err)
		case errors.Is(err, repository.ErrAIActionPreviewStale),
			errors.Is(err, repository.ErrAIActionPreviewAlreadyExecuted),
			errors.Is(err, repository.ErrAIActionPreviewInvalidState):
			respondAPIError(c, http.StatusConflict, err)
		default:
			respondAPIError(c, http.StatusInternalServerError, err)
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func validAIActionPreviewID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') &&
			(char < '0' || char > '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}

func decodeAIActionConfirmationRequest(c *gin.Context, request *service.AIActionConfirmationRequest) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAIActionConfirmationBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(request); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	request.ConfirmationToken = strings.TrimSpace(request.ConfirmationToken)
	if request.ConfirmationToken == "" || len(request.ConfirmationToken) > 256 {
		return errors.New("invalid confirmation token")
	}
	return nil
}

// conversationActor is the owner context every chat-list handler needs, or
// nothing when the request is not an authenticated owner's.
func conversationActor(c *gin.Context) (service.AIActorContext, bool) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return service.AIActorContext{}, false
	}
	if !requireAIOwner(c) {
		return service.AIActorContext{}, false
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return service.AIActorContext{}, false
	}
	return service.AIActorContext{RestaurantID: restaurantID, OwnerUserID: userID, Role: "owner"}, true
}

func conversationIDParam(c *gin.Context) (string, bool) {
	conversationID := strings.TrimSpace(c.Param("conversationID"))
	if conversationID == "" || len(conversationID) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid conversation id"})
		return "", false
	}
	return conversationID, true
}

// ListConversations is the chat list (?trashed=1 for the trash).
func (ctrl *AIController) ListConversations(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	trashed := c.Query("trashed") == "1" || strings.EqualFold(c.Query("trashed"), "true")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	rows, err := ctrl.svc.ListConversationsForOwner(actor, trashed, limit)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"conversations": rows})
}

// ConversationTurns is one page of a chat's transcript (?before=<sequence>).
func (ctrl *AIController) ConversationTurns(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	conversationID, ok := conversationIDParam(c)
	if !ok {
		return
	}
	before, _ := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	turns, err := ctrl.svc.ConversationTurnsForOwner(actor, conversationID, before, limit)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"turns": turns})
}

// RenameConversation stores the owner's title for a chat.
func (ctrl *AIController) RenameConversation(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	conversationID, ok := conversationIDParam(c)
	if !ok {
		return
	}
	var input struct {
		Title string `json:"title" binding:"required,max=200"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	if err := ctrl.svc.RenameConversationForOwner(actor, conversationID, input.Title); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreConversation brings a chat back out of the trash.
func (ctrl *AIController) RestoreConversation(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	conversationID, ok := conversationIDParam(c)
	if !ok {
		return
	}
	if err := ctrl.svc.RestoreConversationForOwner(actor, conversationID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// PurgeConversation deletes one chat for good — reached from the trash only.
func (ctrl *AIController) PurgeConversation(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	conversationID, ok := conversationIDParam(c)
	if !ok {
		return
	}
	if err := ctrl.svc.PurgeConversationForOwner(actor, conversationID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// PurgeAllTrashed empties the trash.
func (ctrl *AIController) PurgeAllTrashed(c *gin.Context) {
	actor, ok := conversationActor(c)
	if !ok {
		return
	}
	deleted, err := ctrl.svc.PurgeAllTrashedForOwner(actor)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": deleted})
}

// DeleteAllConversations is the settings screen's "ล้างประวัติแชททั้งหมด": every
// live chat goes to the trash, where it can still be restored for seven days.
func (ctrl *AIController) DeleteAllConversations(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	deleted, err := ctrl.svc.DeleteAllConversationsForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	})
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": deleted})
}

func (ctrl *AIController) DeleteConversation(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	userID, ok := contextUserID(c)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authenticated owner is required"})
		return
	}
	conversationID := strings.TrimSpace(c.Param("conversationID"))
	if conversationID == "" || len(conversationID) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid conversation id"})
		return
	}
	if err := ctrl.svc.DeleteConversationForOwner(service.AIActorContext{
		RestaurantID: restaurantID,
		OwnerUserID:  userID,
		Role:         "owner",
	}, conversationID); err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ctrl *AIController) OperationsSnapshot(c *gin.Context) {
	restaurantID, ok := requireRestaurant(c)
	if !ok {
		return
	}
	if !requireAIOwner(c) {
		return
	}
	result, err := ctrl.svc.OperationsSnapshot(restaurantID)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

// respondAIOutage answers with the reason and, when the provider named one,
// how long to wait, so the screen can say "back in 42 minutes" instead of a
// generic failure. The message is owner-facing Thai written by the service.
func respondAIOutage(c *gin.Context, status int, code string, err error) {
	body := gin.H{"error": err.Error(), "code": code}
	if seconds := service.AIRetryAfterSeconds(err); seconds > 0 {
		body["retry_after_seconds"] = seconds
		c.Header("Retry-After", strconv.Itoa(seconds))
	}
	c.Header("Cache-Control", "no-store, private")
	c.JSON(status, body)
}
