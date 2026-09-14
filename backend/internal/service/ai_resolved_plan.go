package service

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	// ResolvedPlanSchemaVersion is bumped only when the JSON contract changes in
	// a backward-incompatible way. Provider adapters should request this version.
	ResolvedPlanSchemaVersion = "1.1"
	ResolvedPlanTimezone      = "Asia/Bangkok"
)

// ResolvedPlan is the provider-neutral contract between question understanding
// and backend execution. An LLM may propose this value, but the backend must
// normalize and validate it before considering any tool. A valid plan is never
// authorization: capability, tenant, role, confirmation, and repository policy
// checks remain mandatory at the execution boundary.
//
// The contract deliberately keeps the original and resolved questions together:
// inherited conversation context remains auditable instead of silently replacing
// what the user actually typed.
type ResolvedPlan struct {
	SchemaVersion    string                    `json:"schema_version"`
	OriginalQuestion string                    `json:"original_question"`
	ResolvedQuestion string                    `json:"resolved_question"`
	Task             AITask                    `json:"task"`
	Domain           ResolvedPlanDomain        `json:"domain"`
	Operation        ResolvedPlanOperation     `json:"operation"`
	Action           *ResolvedPlanAction       `json:"action"`
	Parameters       ResolvedPlanParameters    `json:"parameters"`
	ToolHint         AIToolName                `json:"tool_hint"`
	Resolution       ResolvedPlanResolution    `json:"resolution"`
	Policy           ResolvedPlanPolicy        `json:"policy"`
	ResponseStyle    ResolvedPlanResponseStyle `json:"response_style"`
}

type ResolvedPlanDomain string

const (
	ResolvedPlanDomainGeneral     ResolvedPlanDomain = "general"
	ResolvedPlanDomainRestaurant  ResolvedPlanDomain = "restaurant"
	ResolvedPlanDomainSales       ResolvedPlanDomain = "sales"
	ResolvedPlanDomainMenu        ResolvedPlanDomain = "menu"
	ResolvedPlanDomainInventory   ResolvedPlanDomain = "inventory"
	ResolvedPlanDomainOrder       ResolvedPlanDomain = "order"
	ResolvedPlanDomainKitchen     ResolvedPlanDomain = "kitchen"
	ResolvedPlanDomainTable       ResolvedPlanDomain = "table"
	ResolvedPlanDomainReservation ResolvedPlanDomain = "reservation"
	ResolvedPlanDomainStaff       ResolvedPlanDomain = "staff"
	ResolvedPlanDomainCustomer    ResolvedPlanDomain = "customer"
	ResolvedPlanDomainSettings    ResolvedPlanDomain = "settings"
	ResolvedPlanDomainMarketing   ResolvedPlanDomain = "marketing"
	ResolvedPlanDomainProduct     ResolvedPlanDomain = "product"
)

type ResolvedPlanOperation string

const (
	ResolvedPlanOperationChat          ResolvedPlanOperation = "chat"
	ResolvedPlanOperationExplain       ResolvedPlanOperation = "explain"
	ResolvedPlanOperationHelp          ResolvedPlanOperation = "help"
	ResolvedPlanOperationRetrieve      ResolvedPlanOperation = "retrieve"
	ResolvedPlanOperationList          ResolvedPlanOperation = "list"
	ResolvedPlanOperationDetail        ResolvedPlanOperation = "detail"
	ResolvedPlanOperationRank          ResolvedPlanOperation = "rank"
	ResolvedPlanOperationCompare       ResolvedPlanOperation = "compare"
	ResolvedPlanOperationSummarize     ResolvedPlanOperation = "summarize"
	ResolvedPlanOperationBreakdown     ResolvedPlanOperation = "breakdown"
	ResolvedPlanOperationTrend         ResolvedPlanOperation = "trend"
	ResolvedPlanOperationForecast      ResolvedPlanOperation = "forecast"
	ResolvedPlanOperationAnalyze       ResolvedPlanOperation = "analyze"
	ResolvedPlanOperationRecommend     ResolvedPlanOperation = "recommend"
	ResolvedPlanOperationGenerate      ResolvedPlanOperation = "generate"
	ResolvedPlanOperationNavigate      ResolvedPlanOperation = "navigate"
	ResolvedPlanOperationDraftAction   ResolvedPlanOperation = "draft_action"
	ResolvedPlanOperationExecuteAction ResolvedPlanOperation = "execute_action"
	ResolvedPlanOperationClarify       ResolvedPlanOperation = "clarify"
	ResolvedPlanOperationRefuse        ResolvedPlanOperation = "refuse"
)

// ResolvedPlanActionType is intentionally a very small allowlist. New write
// capabilities must add a typed contract and backend policy instead of passing
// arbitrary tool names or argument maps through the model boundary.
type ResolvedPlanActionType string

const (
	ResolvedPlanActionSetMenuAvailability ResolvedPlanActionType = "set_menu_availability"
)

type ResolvedPlanAction struct {
	Type      ResolvedPlanActionType      `json:"type"`
	Arguments ResolvedPlanActionArguments `json:"arguments"`
}

type ResolvedPlanActionArguments struct {
	IsAvailable bool `json:"is_available"`
}

type ResolvedPlanMetric string

const (
	ResolvedPlanMetricOverview         ResolvedPlanMetric = "overview"
	ResolvedPlanMetricRevenue          ResolvedPlanMetric = "revenue"
	ResolvedPlanMetricOrderCount       ResolvedPlanMetric = "order_count"
	ResolvedPlanMetricAverageOrder     ResolvedPlanMetric = "average_order_value"
	ResolvedPlanMetricQuantity         ResolvedPlanMetric = "quantity"
	ResolvedPlanMetricPrice            ResolvedPlanMetric = "price"
	ResolvedPlanMetricCost             ResolvedPlanMetric = "cost"
	ResolvedPlanMetricProfit           ResolvedPlanMetric = "profit"
	ResolvedPlanMetricMargin           ResolvedPlanMetric = "margin"
	ResolvedPlanMetricSalesTrend       ResolvedPlanMetric = "sales_trend"
	ResolvedPlanMetricOrderTypeShare   ResolvedPlanMetric = "order_type_share"
	ResolvedPlanMetricPeakPeriod       ResolvedPlanMetric = "peak_period"
	ResolvedPlanMetricStockLevel       ResolvedPlanMetric = "stock_level"
	ResolvedPlanMetricInventoryValue   ResolvedPlanMetric = "inventory_value"
	ResolvedPlanMetricUsage            ResolvedPlanMetric = "usage"
	ResolvedPlanMetricDaysLeft         ResolvedPlanMetric = "days_left"
	ResolvedPlanMetricDeadStock        ResolvedPlanMetric = "dead_stock"
	ResolvedPlanMetricDataCoverage     ResolvedPlanMetric = "data_coverage"
	ResolvedPlanMetricStatus           ResolvedPlanMetric = "status"
	ResolvedPlanMetricDuration         ResolvedPlanMetric = "duration"
	ResolvedPlanMetricAvailability     ResolvedPlanMetric = "availability"
	ResolvedPlanMetricWaitTime         ResolvedPlanMetric = "wait_time"
	ResolvedPlanMetricTableUtilization ResolvedPlanMetric = "table_utilization"
	ResolvedPlanMetricCancellationRate ResolvedPlanMetric = "cancellation_rate"
	ResolvedPlanMetricNoShowRate       ResolvedPlanMetric = "no_show_rate"
)

type ResolvedPlanGroupDimension string

const (
	ResolvedPlanGroupMenu        ResolvedPlanGroupDimension = "menu"
	ResolvedPlanGroupIngredient  ResolvedPlanGroupDimension = "ingredient"
	ResolvedPlanGroupOrderType   ResolvedPlanGroupDimension = "order_type"
	ResolvedPlanGroupDay         ResolvedPlanGroupDimension = "day"
	ResolvedPlanGroupWeek        ResolvedPlanGroupDimension = "week"
	ResolvedPlanGroupMonth       ResolvedPlanGroupDimension = "month"
	ResolvedPlanGroupWeekday     ResolvedPlanGroupDimension = "weekday"
	ResolvedPlanGroupHour        ResolvedPlanGroupDimension = "hour"
	ResolvedPlanGroupTable       ResolvedPlanGroupDimension = "table"
	ResolvedPlanGroupTableZone   ResolvedPlanGroupDimension = "table_zone"
	ResolvedPlanGroupStatus      ResolvedPlanGroupDimension = "status"
	ResolvedPlanGroupStaffMember ResolvedPlanGroupDimension = "staff_member"
)

type ResolvedPlanEntityType string

const (
	ResolvedPlanEntityRestaurant  ResolvedPlanEntityType = "restaurant"
	ResolvedPlanEntityMenu        ResolvedPlanEntityType = "menu"
	ResolvedPlanEntityIngredient  ResolvedPlanEntityType = "ingredient"
	ResolvedPlanEntityCategory    ResolvedPlanEntityType = "category"
	ResolvedPlanEntityOrder       ResolvedPlanEntityType = "order"
	ResolvedPlanEntityTable       ResolvedPlanEntityType = "table"
	ResolvedPlanEntityReservation ResolvedPlanEntityType = "reservation"
	ResolvedPlanEntityStaff       ResolvedPlanEntityType = "staff"
	ResolvedPlanEntityCustomer    ResolvedPlanEntityType = "customer"
)

type ResolvedPlanTimeRangeKind string

const (
	ResolvedPlanTimeRangeDay     ResolvedPlanTimeRangeKind = "day"
	ResolvedPlanTimeRangeWeek    ResolvedPlanTimeRangeKind = "week"
	ResolvedPlanTimeRangeMonth   ResolvedPlanTimeRangeKind = "month"
	ResolvedPlanTimeRangeRolling ResolvedPlanTimeRangeKind = "rolling"
	ResolvedPlanTimeRangeCustom  ResolvedPlanTimeRangeKind = "custom"
	ResolvedPlanTimeRangeAllTime ResolvedPlanTimeRangeKind = "all_time"
)

type ResolvedPlanFilterOperator string

const (
	ResolvedPlanFilterEqual       ResolvedPlanFilterOperator = "eq"
	ResolvedPlanFilterNotEqual    ResolvedPlanFilterOperator = "neq"
	ResolvedPlanFilterIn          ResolvedPlanFilterOperator = "in"
	ResolvedPlanFilterNotIn       ResolvedPlanFilterOperator = "not_in"
	ResolvedPlanFilterContains    ResolvedPlanFilterOperator = "contains"
	ResolvedPlanFilterGreaterThan ResolvedPlanFilterOperator = "gt"
	ResolvedPlanFilterAtLeast     ResolvedPlanFilterOperator = "gte"
	ResolvedPlanFilterLessThan    ResolvedPlanFilterOperator = "lt"
	ResolvedPlanFilterAtMost      ResolvedPlanFilterOperator = "lte"
)

// ResolvedPlanFilterField is an allowlist, not a database column name. An
// executor must still map each value to a fixed repository query; it must never
// concatenate this value into SQL.
type ResolvedPlanFilterField string

const (
	ResolvedPlanFilterMenuID             ResolvedPlanFilterField = "menu.id"
	ResolvedPlanFilterMenuName           ResolvedPlanFilterField = "menu.name"
	ResolvedPlanFilterMenuCategory       ResolvedPlanFilterField = "menu.category"
	ResolvedPlanFilterMenuStatus         ResolvedPlanFilterField = "menu.status"
	ResolvedPlanFilterIngredientID       ResolvedPlanFilterField = "ingredient.id"
	ResolvedPlanFilterIngredientName     ResolvedPlanFilterField = "ingredient.name"
	ResolvedPlanFilterIngredientCategory ResolvedPlanFilterField = "ingredient.category"
	ResolvedPlanFilterIngredientStatus   ResolvedPlanFilterField = "ingredient.status"
	ResolvedPlanFilterIngredientStorage  ResolvedPlanFilterField = "ingredient.storage_type"
	ResolvedPlanFilterOrderType          ResolvedPlanFilterField = "order.type"
	ResolvedPlanFilterOrderStatus        ResolvedPlanFilterField = "order.status"
	ResolvedPlanFilterOrderPaymentStatus ResolvedPlanFilterField = "order.payment_status"
	ResolvedPlanFilterReservationStatus  ResolvedPlanFilterField = "reservation.status"
	ResolvedPlanFilterTableStatus        ResolvedPlanFilterField = "table.status"
	ResolvedPlanFilterTableZone          ResolvedPlanFilterField = "table.zone"
	ResolvedPlanFilterStaffID            ResolvedPlanFilterField = "staff.id"
	ResolvedPlanFilterStaffRole          ResolvedPlanFilterField = "staff.role"
	ResolvedPlanFilterStaffStatus        ResolvedPlanFilterField = "staff.status"
	ResolvedPlanFilterCustomerID         ResolvedPlanFilterField = "customer.id"
	ResolvedPlanFilterCustomerName       ResolvedPlanFilterField = "customer.name"
)

type ResolvedPlanRankDirection string

const (
	ResolvedPlanRankHigh ResolvedPlanRankDirection = "high"
	ResolvedPlanRankLow  ResolvedPlanRankDirection = "low"
)

type ResolvedPlanContextSource string

const (
	ResolvedPlanSourceConversation ResolvedPlanContextSource = "conversation_history"
	ResolvedPlanSourceToolResult   ResolvedPlanContextSource = "tool_result"
)

type ResolvedPlanField string

const (
	ResolvedPlanFieldTask             ResolvedPlanField = "task"
	ResolvedPlanFieldDomain           ResolvedPlanField = "domain"
	ResolvedPlanFieldOperation        ResolvedPlanField = "operation"
	ResolvedPlanFieldMetrics          ResolvedPlanField = "parameters.metrics"
	ResolvedPlanFieldEntities         ResolvedPlanField = "parameters.entities"
	ResolvedPlanFieldTimeRange        ResolvedPlanField = "parameters.time_range"
	ResolvedPlanFieldCompareTimeRange ResolvedPlanField = "parameters.compare_time_range"
	ResolvedPlanFieldDayPart          ResolvedPlanField = "parameters.day_part"
	ResolvedPlanFieldFilters          ResolvedPlanField = "parameters.filters"
	ResolvedPlanFieldRanking          ResolvedPlanField = "parameters.ranking"
	ResolvedPlanFieldGroupBy          ResolvedPlanField = "parameters.group_by"
	ResolvedPlanFieldToolHint         ResolvedPlanField = "tool_hint"
	ResolvedPlanFieldResponseStyle    ResolvedPlanField = "response_style"
)

type ResolvedPlanRiskLevel string

const (
	ResolvedPlanRiskLow    ResolvedPlanRiskLevel = "low"
	ResolvedPlanRiskMedium ResolvedPlanRiskLevel = "medium"
	ResolvedPlanRiskHigh   ResolvedPlanRiskLevel = "high"
)

type ResolvedPlanResponseStyle string

const (
	ResolvedPlanResponseBrief    ResolvedPlanResponseStyle = "brief"
	ResolvedPlanResponseNormal   ResolvedPlanResponseStyle = "normal"
	ResolvedPlanResponseDetailed ResolvedPlanResponseStyle = "detailed"
)

type ResolvedPlanParameters struct {
	Metrics          []ResolvedPlanMetric         `json:"metrics"`
	GroupBy          []ResolvedPlanGroupDimension `json:"group_by"`
	Entities         []ResolvedPlanEntityRef      `json:"entities"`
	TimeRange        *ResolvedPlanTimeRange       `json:"time_range"`
	CompareTimeRange *ResolvedPlanTimeRange       `json:"compare_time_range"`
	DayPart          *ResolvedPlanDayPart         `json:"day_part"`
	Filters          []ResolvedPlanFilter         `json:"filters"`
	Ranking          *ResolvedPlanRanking         `json:"ranking"`
}

type ResolvedPlanEntityRef struct {
	Type        ResolvedPlanEntityType `json:"type"`
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	ResultIndex int                    `json:"result_index"`
	// SourceTurnID is a request-local provenance ID supplied by the context
	// adapter (for example, "history-4"), not a database ID.
	SourceTurnID string `json:"source_turn_id"`
}

// ResolvedPlanTimeRange is a restaurant-local calendar range [StartDate,
// EndDate). Dates are used instead of timestamps so provider timezone behavior
// cannot silently move a sale into another business day.
type ResolvedPlanTimeRange struct {
	Kind      ResolvedPlanTimeRangeKind `json:"kind"`
	Label     string                    `json:"label"`
	StartDate string                    `json:"start_date"`
	EndDate   string                    `json:"end_date"`
	Timezone  string                    `json:"timezone"`
}

type ResolvedPlanDayPart struct {
	Label     string `json:"label"`
	StartHour int    `json:"start_hour"`
	EndHour   int    `json:"end_hour"`
}

type ResolvedPlanFilter struct {
	Field    ResolvedPlanFilterField    `json:"field"`
	Operator ResolvedPlanFilterOperator `json:"operator"`
	Values   []string                   `json:"values"`
}

type ResolvedPlanRanking struct {
	Metric    ResolvedPlanMetric        `json:"metric"`
	Direction ResolvedPlanRankDirection `json:"direction"`
	Rank      int                       `json:"rank"`
	Limit     int                       `json:"limit"`
}

type ResolvedPlanInheritedField struct {
	Field        ResolvedPlanField         `json:"field"`
	Source       ResolvedPlanContextSource `json:"source"`
	SourceTurnID string                    `json:"source_turn_id"`
}

type ResolvedPlanResolution struct {
	InheritedFields       []ResolvedPlanInheritedField `json:"inherited_fields"`
	MissingFields         []ResolvedPlanField          `json:"missing_fields"`
	NeedsClarification    bool                         `json:"needs_clarification"`
	ClarificationQuestion string                       `json:"clarification_question"`
	Confidence            float64                      `json:"confidence"`
}

type ResolvedPlanPolicy struct {
	Risk     ResolvedPlanRiskLevel `json:"risk"`
	ReadOnly bool                  `json:"read_only"`
	// RequiresConfirmation means the server must collect confirmation. A model
	// setting this boolean is never proof that the user already confirmed.
	RequiresConfirmation bool `json:"requires_confirmation"`
}

var (
	resolvedPlanTasks = []AITask{
		AITaskExplainConcept, AITaskScopeQuestion, AITaskRetrieveFact, AITaskAnalyzeData,
		AITaskRecommendAction, AITaskGeneralChat, AITaskRestaurantAdvice,
		AITaskRestaurantContent, AITaskProductHelp, AITaskRiskyAction, AITaskUnclear,
		AITaskOutOfScope,
	}
	resolvedPlanDomains = []ResolvedPlanDomain{
		ResolvedPlanDomainGeneral, ResolvedPlanDomainRestaurant, ResolvedPlanDomainSales,
		ResolvedPlanDomainMenu, ResolvedPlanDomainInventory, ResolvedPlanDomainOrder,
		ResolvedPlanDomainKitchen, ResolvedPlanDomainTable, ResolvedPlanDomainReservation,
		ResolvedPlanDomainStaff, ResolvedPlanDomainCustomer, ResolvedPlanDomainSettings,
		ResolvedPlanDomainMarketing, ResolvedPlanDomainProduct,
	}
	resolvedPlanOperations = []ResolvedPlanOperation{
		ResolvedPlanOperationChat, ResolvedPlanOperationExplain, ResolvedPlanOperationHelp,
		ResolvedPlanOperationRetrieve, ResolvedPlanOperationList, ResolvedPlanOperationDetail,
		ResolvedPlanOperationRank, ResolvedPlanOperationCompare, ResolvedPlanOperationSummarize,
		ResolvedPlanOperationBreakdown, ResolvedPlanOperationTrend, ResolvedPlanOperationForecast,
		ResolvedPlanOperationAnalyze, ResolvedPlanOperationRecommend, ResolvedPlanOperationGenerate,
		ResolvedPlanOperationNavigate, ResolvedPlanOperationDraftAction, ResolvedPlanOperationExecuteAction,
		ResolvedPlanOperationClarify, ResolvedPlanOperationRefuse,
	}
	resolvedPlanActionTypes = []ResolvedPlanActionType{
		ResolvedPlanActionSetMenuAvailability,
	}
	resolvedPlanMetrics = []ResolvedPlanMetric{
		ResolvedPlanMetricOverview, ResolvedPlanMetricRevenue, ResolvedPlanMetricOrderCount,
		ResolvedPlanMetricAverageOrder, ResolvedPlanMetricQuantity, ResolvedPlanMetricPrice,
		ResolvedPlanMetricCost, ResolvedPlanMetricProfit, ResolvedPlanMetricMargin,
		ResolvedPlanMetricSalesTrend, ResolvedPlanMetricOrderTypeShare, ResolvedPlanMetricPeakPeriod,
		ResolvedPlanMetricStockLevel, ResolvedPlanMetricInventoryValue, ResolvedPlanMetricUsage,
		ResolvedPlanMetricDaysLeft, ResolvedPlanMetricDeadStock, ResolvedPlanMetricDataCoverage,
		ResolvedPlanMetricStatus, ResolvedPlanMetricDuration, ResolvedPlanMetricAvailability,
		ResolvedPlanMetricWaitTime, ResolvedPlanMetricTableUtilization,
		ResolvedPlanMetricCancellationRate, ResolvedPlanMetricNoShowRate,
	}
	resolvedPlanGroupDimensions = []ResolvedPlanGroupDimension{
		ResolvedPlanGroupMenu, ResolvedPlanGroupIngredient, ResolvedPlanGroupOrderType,
		ResolvedPlanGroupDay, ResolvedPlanGroupWeek, ResolvedPlanGroupMonth,
		ResolvedPlanGroupWeekday, ResolvedPlanGroupHour, ResolvedPlanGroupTable,
		ResolvedPlanGroupTableZone, ResolvedPlanGroupStatus, ResolvedPlanGroupStaffMember,
	}
	resolvedPlanEntityTypes = []ResolvedPlanEntityType{
		ResolvedPlanEntityRestaurant, ResolvedPlanEntityMenu, ResolvedPlanEntityIngredient,
		ResolvedPlanEntityCategory, ResolvedPlanEntityOrder, ResolvedPlanEntityTable,
		ResolvedPlanEntityReservation, ResolvedPlanEntityStaff, ResolvedPlanEntityCustomer,
	}
	resolvedPlanTimeRangeKinds = []ResolvedPlanTimeRangeKind{
		ResolvedPlanTimeRangeDay, ResolvedPlanTimeRangeWeek, ResolvedPlanTimeRangeMonth,
		ResolvedPlanTimeRangeRolling, ResolvedPlanTimeRangeCustom, ResolvedPlanTimeRangeAllTime,
	}
	resolvedPlanFilterOperators = []ResolvedPlanFilterOperator{
		ResolvedPlanFilterEqual, ResolvedPlanFilterNotEqual, ResolvedPlanFilterIn,
		ResolvedPlanFilterNotIn, ResolvedPlanFilterContains, ResolvedPlanFilterGreaterThan,
		ResolvedPlanFilterAtLeast, ResolvedPlanFilterLessThan, ResolvedPlanFilterAtMost,
	}
	resolvedPlanFilterFields = []ResolvedPlanFilterField{
		ResolvedPlanFilterMenuID, ResolvedPlanFilterMenuName, ResolvedPlanFilterMenuCategory,
		ResolvedPlanFilterMenuStatus, ResolvedPlanFilterIngredientID, ResolvedPlanFilterIngredientName,
		ResolvedPlanFilterIngredientCategory, ResolvedPlanFilterIngredientStatus,
		ResolvedPlanFilterIngredientStorage, ResolvedPlanFilterOrderType, ResolvedPlanFilterOrderStatus,
		ResolvedPlanFilterOrderPaymentStatus, ResolvedPlanFilterReservationStatus,
		ResolvedPlanFilterTableStatus, ResolvedPlanFilterTableZone, ResolvedPlanFilterStaffID,
		ResolvedPlanFilterStaffRole, ResolvedPlanFilterStaffStatus, ResolvedPlanFilterCustomerID,
		ResolvedPlanFilterCustomerName,
	}
	resolvedPlanRankDirections = []ResolvedPlanRankDirection{
		ResolvedPlanRankHigh, ResolvedPlanRankLow,
	}
	resolvedPlanContextSources = []ResolvedPlanContextSource{
		ResolvedPlanSourceConversation, ResolvedPlanSourceToolResult,
	}
	resolvedPlanFields = []ResolvedPlanField{
		ResolvedPlanFieldTask, ResolvedPlanFieldDomain, ResolvedPlanFieldOperation,
		ResolvedPlanFieldMetrics, ResolvedPlanFieldEntities, ResolvedPlanFieldTimeRange,
		ResolvedPlanFieldCompareTimeRange, ResolvedPlanFieldDayPart, ResolvedPlanFieldFilters,
		ResolvedPlanFieldRanking, ResolvedPlanFieldGroupBy, ResolvedPlanFieldToolHint,
		ResolvedPlanFieldResponseStyle,
	}
	resolvedPlanRiskLevels = []ResolvedPlanRiskLevel{
		ResolvedPlanRiskLow, ResolvedPlanRiskMedium, ResolvedPlanRiskHigh,
	}
	resolvedPlanResponseStyles = []ResolvedPlanResponseStyle{
		ResolvedPlanResponseBrief, ResolvedPlanResponseNormal, ResolvedPlanResponseDetailed,
	}
)

// Normalize returns a canonical deep copy. The input remains unchanged even
// when its slices have spare capacity and share a backing array.
func (p ResolvedPlan) Normalize() ResolvedPlan {
	p.SchemaVersion = strings.TrimSpace(p.SchemaVersion)
	p.OriginalQuestion = strings.TrimSpace(p.OriginalQuestion)
	p.ResolvedQuestion = strings.TrimSpace(p.ResolvedQuestion)
	p.Task = resolveTaskAlias(AITask(normalizeEnum(string(p.Task))))
	p.Domain = ResolvedPlanDomain(normalizeEnum(string(p.Domain)))
	p.Operation = ResolvedPlanOperation(normalizeEnum(string(p.Operation)))
	p.Operation = alignOperationWithTask(p.Task, p.Operation)
	p.Action = normalizeResolvedPlanAction(p.Action)
	p.ToolHint = AIToolName(normalizeEnum(string(p.ToolHint)))
	p.ResponseStyle = ResolvedPlanResponseStyle(normalizeEnum(string(p.ResponseStyle)))
	p.Policy.Risk = ResolvedPlanRiskLevel(normalizeEnum(string(p.Policy.Risk)))

	p.Parameters.Metrics = normalizeUniqueEnums(p.Parameters.Metrics)
	p.Parameters.GroupBy = normalizeUniqueEnums(p.Parameters.GroupBy)
	p.Parameters.GroupBy = fillImpliedGroupBy(p.Domain, p.Operation, p.Parameters.GroupBy)
	p.Parameters.Metrics = fillImpliedMetrics(p.Domain, p.Operation, p.Parameters.Metrics)
	p.Parameters.Entities = normalizeEntities(p.Parameters.Entities)
	p.Parameters.TimeRange = normalizeTimeRange(p.Parameters.TimeRange)
	p.Parameters.CompareTimeRange = normalizeTimeRange(p.Parameters.CompareTimeRange)
	p.Parameters.DayPart = normalizeDayPart(p.Parameters.DayPart)
	p.Parameters.Filters = normalizeFilters(p.Parameters.Filters)
	p.Parameters.Ranking = normalizeRanking(p.Parameters.Ranking)
	if p.Parameters.Ranking != nil && !operationSupportsRanking(p.Operation) {
		// Asking for the top one by quantity IS a ranking, whatever the operation
		// field was set to. "which menu sells best" came back as operation=retrieve
		// carrying a complete ranking, and dropping the ranking left a plan with
		// nothing to retrieve, which was then refused. The ranking is the more
		// specific statement of what was asked, so it decides - but only where the
		// task already allows ranking, and only where there is something to rank
		// BY: a sales total carrying a stray ranking has no grouping and never
		// will, so there the ranking is still the stray field and is dropped.
		promoted := fillImpliedGroupBy(p.Domain, ResolvedPlanOperationRank, p.Parameters.GroupBy)
		if len(promoted) > 0 && taskAllowsOperation(p.Task, ResolvedPlanOperationRank) {
			p.Operation = ResolvedPlanOperationRank
		} else {
			p.Parameters.Ranking = nil
		}
	}
	// A ranking names the metric it orders by, and the contract already insists
	// that metric appears in the list. When the model filled in the ranking and
	// left the list empty it said the same thing twice over, once; taking it from
	// there beats refusing a plan that is not actually ambiguous.
	if len(p.Parameters.Metrics) == 0 && p.Parameters.Ranking != nil && p.Parameters.Ranking.Metric != "" {
		p.Parameters.Metrics = []ResolvedPlanMetric{p.Parameters.Ranking.Metric}
	}
	// The grouping was filled in above against the operation as written. A
	// ranking may have changed it since, and rank needs a grouping, so the same
	// rule is applied once more; it does nothing when a grouping already exists.
	p.Parameters.GroupBy = fillImpliedGroupBy(p.Domain, p.Operation, p.Parameters.GroupBy)
	p.Resolution.InheritedFields = normalizeInheritedFields(p.Resolution.InheritedFields)
	for i := range p.Resolution.InheritedFields {
		p.Resolution.InheritedFields[i].Field = qualifyPlanField(p.Resolution.InheritedFields[i].Field)
	}
	p.Resolution.MissingFields = normalizeUniqueEnums(p.Resolution.MissingFields)
	for i, field := range p.Resolution.MissingFields {
		p.Resolution.MissingFields[i] = qualifyPlanField(field)
	}
	// A field cannot be both carried over from an earlier turn and still missing.
	// Models sometimes list the same field in both; the inherited entry carries a
	// value, so it wins and the contradictory "missing" entry is dropped.
	p.Resolution.MissingFields = dropInheritedFromMissing(p.Resolution.InheritedFields, p.Resolution.MissingFields)
	p.Resolution.ClarificationQuestion = strings.TrimSpace(p.Resolution.ClarificationQuestion)
	return p
}

// NormalizeAndValidateResolvedPlan is the safe structural entry point for
// provider output. Success means well-formed and policy-consistent, not that an
// action or tool has been authorized.
func NormalizeAndValidateResolvedPlan(plan ResolvedPlan) (ResolvedPlan, error) {
	plan = plan.Normalize()
	if err := plan.Validate(); err != nil {
		return ResolvedPlan{}, err
	}
	return plan, nil
}

func (p ResolvedPlan) Validate() error {
	if p.SchemaVersion != ResolvedPlanSchemaVersion {
		return fmt.Errorf("resolved plan: unsupported schema version %q", p.SchemaVersion)
	}
	if p.OriginalQuestion == "" || p.ResolvedQuestion == "" {
		return errors.New("resolved plan: original_question and resolved_question are required")
	}
	if len([]rune(p.OriginalQuestion)) > 2000 || len([]rune(p.ResolvedQuestion)) > 3000 {
		return errors.New("resolved plan: question is too long")
	}
	if !isSupportedResolvedPlanTask(p.Task) {
		return fmt.Errorf("resolved plan: unsupported task %q", p.Task)
	}
	if !containsValue(resolvedPlanDomains, p.Domain) {
		return fmt.Errorf("resolved plan: unsupported domain %q", p.Domain)
	}
	if !containsValue(resolvedPlanOperations, p.Operation) {
		return fmt.Errorf("resolved plan: unsupported operation %q", p.Operation)
	}
	if !taskAllowsOperation(p.Task, p.Operation) {
		return fmt.Errorf("resolved plan: task %q does not allow operation %q", p.Task, p.Operation)
	}
	if p.Task == AITaskProductHelp {
		if p.Domain != ResolvedPlanDomainProduct {
			return fmt.Errorf("resolved plan: product_help requires domain %q", ResolvedPlanDomainProduct)
		}
		if !isSystemDocsTool(p.ToolHint) {
			return errors.New("resolved plan: product_help requires a system documentation tool_hint")
		}
	} else if isSystemDocsTool(p.ToolHint) {
		return errors.New("resolved plan: system documentation tools are only allowed for product_help")
	}
	if !containsValue(resolvedPlanResponseStyles, p.ResponseStyle) {
		return fmt.Errorf("resolved plan: unsupported response_style %q", p.ResponseStyle)
	}
	if err := p.Parameters.validate(); err != nil {
		return err
	}
	if err := p.validateActionContract(); err != nil {
		return err
	}
	if p.Operation == ResolvedPlanOperationRank {
		if p.Parameters.Ranking == nil {
			return errors.New("resolved plan: operation=rank requires parameters.ranking")
		}
		if len(p.Parameters.GroupBy) == 0 {
			return errors.New("resolved plan: operation=rank requires parameters.group_by")
		}
	} else if p.Parameters.Ranking != nil && !operationSupportsRanking(p.Operation) {
		return fmt.Errorf("resolved plan: parameters.ranking is not allowed for operation %q", p.Operation)
	}
	if p.Operation == ResolvedPlanOperationBreakdown && len(p.Parameters.GroupBy) == 0 {
		return errors.New("resolved plan: operation=breakdown requires parameters.group_by")
	}
	if p.Operation == ResolvedPlanOperationCompare {
		hasPeriodPair := p.Parameters.TimeRange != nil && p.Parameters.CompareTimeRange != nil
		hasEntityPair := len(p.Parameters.Entities) == 2
		if !hasPeriodPair && !hasEntityPair {
			return errors.New("resolved plan: operation=compare requires two time ranges or two entities")
		}
	}
	if err := p.validateCompleteness(); err != nil {
		return err
	}
	if err := p.Resolution.validate(p.Task, p.Operation); err != nil {
		return err
	}
	if err := validateResolvedPlanEntityProvenance(p.Parameters.Entities, p.Resolution.InheritedFields); err != nil {
		return err
	}
	if err := p.Policy.validate(p.Task, p.Operation); err != nil {
		return err
	}
	if p.ToolHint != "" {
		if !isSupportedReadOnlyTool(p.ToolHint) {
			return fmt.Errorf("resolved plan: unsupported read-only tool_hint %q", p.ToolHint)
		}
		if !p.Policy.ReadOnly {
			return errors.New("resolved plan: tool_hint is only allowed in a read-only plan")
		}
		if !toolSupportsResolvedPlanDomain(p.ToolHint, p.Domain) {
			return fmt.Errorf("resolved plan: tool_hint %q does not support domain %q", p.ToolHint, p.Domain)
		}
		switch p.Task {
		case AITaskRetrieveFact, AITaskAnalyzeData, AITaskRecommendAction, AITaskProductHelp:
		default:
			return fmt.Errorf("resolved plan: task %q cannot carry a tool_hint", p.Task)
		}
	}
	return nil
}

func (p ResolvedPlan) validateActionContract() error {
	isMenuAvailabilityAction := p.Task == AITaskRiskyAction &&
		p.Domain == ResolvedPlanDomainMenu &&
		p.Operation == ResolvedPlanOperationExecuteAction

	if !isMenuAvailabilityAction {
		if p.Action != nil {
			return errors.New("resolved plan: action is only allowed for risky_action in the menu domain with operation=execute_action")
		}
		if p.Operation == ResolvedPlanOperationExecuteAction {
			return errors.New("resolved plan: execute_action is only allowed for the reviewed menu availability action")
		}
		return nil
	}

	if p.Action == nil {
		return errors.New("resolved plan: menu execute_action requires action")
	}
	if !containsValue(resolvedPlanActionTypes, p.Action.Type) {
		return fmt.Errorf("resolved plan: unsupported action type %q", p.Action.Type)
	}
	if p.Action.Type != ResolvedPlanActionSetMenuAvailability {
		return fmt.Errorf("resolved plan: action type %q is not available for menu execution", p.Action.Type)
	}
	if len(p.Parameters.Entities) != 1 {
		return errors.New("resolved plan: set_menu_availability requires exactly one menu entity")
	}
	menu := p.Parameters.Entities[0]
	if menu.Type != ResolvedPlanEntityMenu {
		return errors.New("resolved plan: set_menu_availability target must be a menu entity")
	}
	if menu.ID == "" && menu.Name == "" {
		return errors.New("resolved plan: set_menu_availability target requires a menu id or exact name")
	}
	if menu.ResultIndex != 0 {
		return errors.New("resolved plan: set_menu_availability target cannot use result_index")
	}
	return nil
}

func (p ResolvedPlan) validateCompleteness() error {
	switch p.Operation {
	case ResolvedPlanOperationRetrieve:
		if len(p.Parameters.Metrics) == 0 && len(p.Parameters.Entities) == 0 && p.ToolHint == "" {
			return errors.New("resolved plan: operation=retrieve requires metrics, entities, or tool_hint")
		}
	case ResolvedPlanOperationDetail:
		if len(p.Parameters.Entities) == 0 {
			return errors.New("resolved plan: operation=detail requires parameters.entities")
		}
	case ResolvedPlanOperationSummarize, ResolvedPlanOperationBreakdown,
		ResolvedPlanOperationTrend, ResolvedPlanOperationForecast, ResolvedPlanOperationAnalyze:
		if len(p.Parameters.Metrics) == 0 {
			return fmt.Errorf("resolved plan: operation=%s requires parameters.metrics", p.Operation)
		}
	}
	return nil
}

func (p ResolvedPlanParameters) validate() error {
	if len(p.Metrics) > 8 {
		return errors.New("resolved plan: metrics exceeds the maximum of 8")
	}
	if err := validateUniqueEnums("metric", p.Metrics, resolvedPlanMetrics); err != nil {
		return err
	}
	if len(p.GroupBy) > 2 {
		return errors.New("resolved plan: group_by exceeds the maximum of 2")
	}
	if err := validateUniqueEnums("group_by", p.GroupBy, resolvedPlanGroupDimensions); err != nil {
		return err
	}
	if len(p.Entities) > 20 {
		return errors.New("resolved plan: entities exceeds the maximum of 20")
	}
	for i, entity := range p.Entities {
		if err := entity.validate(); err != nil {
			return fmt.Errorf("resolved plan: entities[%d]: %w", i, err)
		}
	}
	if err := validateUniqueEntities(p.Entities); err != nil {
		return err
	}
	if p.TimeRange != nil {
		if err := p.TimeRange.validate("time_range"); err != nil {
			return err
		}
	}
	if p.CompareTimeRange != nil {
		if err := p.CompareTimeRange.validate("compare_time_range"); err != nil {
			return err
		}
		if p.TimeRange == nil {
			return errors.New("resolved plan: compare_time_range requires time_range")
		}
		if sameTimeRange(*p.TimeRange, *p.CompareTimeRange) {
			return errors.New("resolved plan: comparison ranges must be different")
		}
	}
	if p.DayPart != nil {
		if err := p.DayPart.validate(); err != nil {
			return err
		}
	}
	if len(p.Filters) > 20 {
		return errors.New("resolved plan: filters exceeds the maximum of 20")
	}
	for i, filter := range p.Filters {
		if err := filter.validate(); err != nil {
			return fmt.Errorf("resolved plan: filters[%d]: %w", i, err)
		}
	}
	if p.Ranking != nil {
		if err := p.Ranking.validate(p.Metrics); err != nil {
			return err
		}
	}
	return nil
}

func (e ResolvedPlanEntityRef) validate() error {
	if !containsValue(resolvedPlanEntityTypes, e.Type) {
		return fmt.Errorf("unsupported entity type %q", e.Type)
	}
	if e.ID == "" && e.Name == "" && e.ResultIndex == 0 {
		return errors.New("id, name, or result_index is required")
	}
	if e.ResultIndex < 0 || e.ResultIndex > 100 {
		return errors.New("result_index must be between 0 and 100")
	}
	if e.ResultIndex > 0 && e.SourceTurnID == "" {
		return errors.New("result_index requires source_turn_id")
	}
	if len([]rune(e.ID)) > 128 || len([]rune(e.Name)) > 200 || len([]rune(e.SourceTurnID)) > 128 {
		return errors.New("entity reference is too long")
	}
	return nil
}

func (r ResolvedPlanTimeRange) validate(field string) error {
	if !containsValue(resolvedPlanTimeRangeKinds, r.Kind) {
		return fmt.Errorf("resolved plan: %s has unsupported kind %q", field, r.Kind)
	}
	if r.Timezone != ResolvedPlanTimezone {
		return fmt.Errorf("resolved plan: %s timezone must be %q", field, ResolvedPlanTimezone)
	}
	if r.Label == "" || len([]rune(r.Label)) > 120 {
		return fmt.Errorf("resolved plan: %s label is required and must be at most 120 characters", field)
	}
	if r.Kind == ResolvedPlanTimeRangeAllTime {
		if r.StartDate != "" || r.EndDate != "" {
			return fmt.Errorf("resolved plan: %s all_time must not contain dates", field)
		}
		return nil
	}
	start, err := time.Parse("2006-01-02", r.StartDate)
	if err != nil {
		return fmt.Errorf("resolved plan: %s start_date must use YYYY-MM-DD", field)
	}
	end, err := time.Parse("2006-01-02", r.EndDate)
	if err != nil {
		return fmt.Errorf("resolved plan: %s end_date must use YYYY-MM-DD", field)
	}
	if !start.Before(end) {
		return fmt.Errorf("resolved plan: %s must satisfy start_date < end_date", field)
	}
	return nil
}

func (d ResolvedPlanDayPart) validate() error {
	if d.Label == "" || len([]rune(d.Label)) > 80 {
		return errors.New("resolved plan: day_part label is required and must be at most 80 characters")
	}
	if d.StartHour < 0 || d.StartHour >= d.EndHour || d.EndHour > 24 {
		return errors.New("resolved plan: day_part must satisfy 0 <= start_hour < end_hour <= 24")
	}
	return nil
}

func (f ResolvedPlanFilter) validate() error {
	if !containsValue(resolvedPlanFilterFields, f.Field) {
		return fmt.Errorf("unsupported filter field %q", f.Field)
	}
	if !containsValue(resolvedPlanFilterOperators, f.Operator) {
		return fmt.Errorf("unsupported filter operator %q", f.Operator)
	}
	if len(f.Values) == 0 || len(f.Values) > 20 {
		return errors.New("filter values must contain 1 to 20 items")
	}
	seen := make(map[string]struct{}, len(f.Values))
	for _, value := range f.Values {
		if value == "" || len([]rune(value)) > 200 {
			return errors.New("filter value is empty or too long")
		}
		if _, exists := seen[value]; exists {
			return fmt.Errorf("duplicate filter value %q", value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func (r ResolvedPlanRanking) validate(metrics []ResolvedPlanMetric) error {
	if !containsValue(resolvedPlanMetrics, r.Metric) {
		return fmt.Errorf("resolved plan: ranking has unsupported metric %q", r.Metric)
	}
	if !containsValue(metrics, r.Metric) {
		return errors.New("resolved plan: ranking metric must also appear in parameters.metrics")
	}
	if !containsValue(resolvedPlanRankDirections, r.Direction) {
		return fmt.Errorf("resolved plan: ranking has unsupported direction %q", r.Direction)
	}
	if r.Rank < 1 {
		return errors.New("resolved plan: ranking rank must be at least 1")
	}
	if r.Limit < 1 || r.Limit > 100 {
		return errors.New("resolved plan: ranking limit must be between 1 and 100")
	}
	return nil
}

func (r ResolvedPlanResolution) validate(task AITask, operation ResolvedPlanOperation) error {
	if math.IsNaN(r.Confidence) || math.IsInf(r.Confidence, 0) || r.Confidence < 0 || r.Confidence > 1 {
		return errors.New("resolved plan: resolution confidence must be a finite number between 0 and 1")
	}
	if len(r.InheritedFields) > 20 || len(r.MissingFields) > 20 {
		return errors.New("resolved plan: resolution fields exceed the maximum of 20")
	}
	inherited := make(map[ResolvedPlanField]struct{}, len(r.InheritedFields))
	for i, item := range r.InheritedFields {
		if !containsValue(resolvedPlanFields, item.Field) {
			return fmt.Errorf("resolved plan: inherited_fields[%d] has unsupported field %q", i, item.Field)
		}
		if !containsValue(resolvedPlanContextSources, item.Source) {
			return fmt.Errorf("resolved plan: inherited_fields[%d] has unsupported source %q", i, item.Source)
		}
		if item.SourceTurnID == "" || len([]rune(item.SourceTurnID)) > 128 {
			return fmt.Errorf("resolved plan: inherited_fields[%d] requires a valid source_turn_id", i)
		}
		if _, exists := inherited[item.Field]; exists {
			return fmt.Errorf("resolved plan: duplicate inherited field %q", item.Field)
		}
		inherited[item.Field] = struct{}{}
	}
	missing := make(map[ResolvedPlanField]struct{}, len(r.MissingFields))
	for _, field := range r.MissingFields {
		if !containsValue(resolvedPlanFields, field) {
			return fmt.Errorf("resolved plan: unsupported missing field %q", field)
		}
		if _, exists := missing[field]; exists {
			return fmt.Errorf("resolved plan: duplicate missing field %q", field)
		}
		if _, exists := inherited[field]; exists {
			return fmt.Errorf("resolved plan: field %q cannot be both inherited and missing", field)
		}
		missing[field] = struct{}{}
	}
	if r.NeedsClarification {
		if len(r.MissingFields) == 0 || r.ClarificationQuestion == "" {
			return errors.New("resolved plan: clarification requires missing_fields and clarification_question")
		}
		if task != AITaskUnclear || operation != ResolvedPlanOperationClarify {
			return errors.New("resolved plan: clarification requires task=unclear and operation=clarify")
		}
		return nil
	}
	if len(r.MissingFields) != 0 || r.ClarificationQuestion != "" {
		return errors.New("resolved plan: unresolved fields require needs_clarification=true")
	}
	if task == AITaskUnclear || operation == ResolvedPlanOperationClarify {
		return errors.New("resolved plan: unclear/clarify requires needs_clarification=true")
	}
	return nil
}

func (p ResolvedPlanPolicy) validate(task AITask, operation ResolvedPlanOperation) error {
	if !containsValue(resolvedPlanRiskLevels, p.Risk) {
		return fmt.Errorf("resolved plan: unsupported risk %q", p.Risk)
	}
	if operation == ResolvedPlanOperationExecuteAction {
		if task != AITaskRiskyAction || p.ReadOnly || !p.RequiresConfirmation || p.Risk != ResolvedPlanRiskHigh {
			return errors.New("resolved plan: execute_action requires risky_action, risk=high, read_only=false, and confirmation")
		}
		return nil
	}
	if !p.ReadOnly {
		return errors.New("resolved plan: non-execution operations must be read_only")
	}
	if p.RequiresConfirmation {
		return errors.New("resolved plan: read-only operations must not require confirmation")
	}
	return nil
}

// taskAliases maps the names providers write for a task onto the names the
// contract uses. Every entry is a real answer that was thrown away: the model
// wrote the OPERATION where the task belongs - "retrieve", "recommend",
// "refuse" - and the whole plan was discarded over a label, while the rest of it
// described the question correctly.
//
// "refuse" resolves to risky_action rather than out_of_scope on purpose. Both
// refuse, so the user sees a refusal either way, and risky_action is the more
// cautious reading: it keeps the plan inside the write-safety path instead of
// filing a write command away as an unrelated question.
var taskAliases = map[AITask]AITask{
	"retrieve":  AITaskRetrieveFact,
	"analyze":   AITaskAnalyzeData,
	"recommend": AITaskRecommendAction,
	"refuse":    AITaskRiskyAction,
	"clarify":   AITaskUnclear,
	"chat":      AITaskGeneralChat,
	"generate":  AITaskRestaurantContent,
	"explain":   AITaskExplainConcept,
	"help":      AITaskScopeQuestion,
}

func resolveTaskAlias(task AITask) AITask {
	if isSupportedResolvedPlanTask(task) {
		return task
	}
	if aliased, ok := taskAliases[task]; ok {
		return aliased
	}
	return task
}

// soleOperationForTask reports the one operation a task can carry, when it has
// exactly one. These are all the non-analytical tasks, where the task alone
// decides what happens: an out_of_scope plan refuses, an unclear plan asks.
func soleOperationForTask(task AITask) (ResolvedPlanOperation, bool) {
	switch task {
	case AITaskExplainConcept:
		return ResolvedPlanOperationExplain, true
	case AITaskScopeQuestion:
		return ResolvedPlanOperationHelp, true
	case AITaskGeneralChat:
		return ResolvedPlanOperationChat, true
	case AITaskRestaurantContent:
		return ResolvedPlanOperationGenerate, true
	case AITaskUnclear:
		return ResolvedPlanOperationClarify, true
	case AITaskOutOfScope:
		return ResolvedPlanOperationRefuse, true
	default:
		return "", false
	}
}

// alignOperationWithTask settles a disagreement between the two fields in favour
// of the task, but only where the task leaves no choice. A model that answered
// out_of_scope with operation=chat still means "do not do this"; discarding the
// plan for the mismatch replaced a refusal with an apology. Analytical tasks
// allow several operations, so a mismatch there is left to fail rather than
// guessed at.
func alignOperationWithTask(task AITask, operation ResolvedPlanOperation) ResolvedPlanOperation {
	if taskAllowsOperation(task, operation) {
		return operation
	}
	if sole, ok := soleOperationForTask(task); ok {
		return sole
	}
	return operation
}

func isSupportedResolvedPlanTask(task AITask) bool {
	return containsValue(resolvedPlanTasks, task)
}

func taskAllowsOperation(task AITask, operation ResolvedPlanOperation) bool {
	switch task {
	case AITaskExplainConcept:
		return operation == ResolvedPlanOperationExplain
	case AITaskScopeQuestion:
		return operation == ResolvedPlanOperationHelp
	case AITaskRetrieveFact:
		return containsValue([]ResolvedPlanOperation{
			ResolvedPlanOperationRetrieve, ResolvedPlanOperationList, ResolvedPlanOperationDetail,
			ResolvedPlanOperationRank, ResolvedPlanOperationCompare, ResolvedPlanOperationSummarize,
			ResolvedPlanOperationBreakdown, ResolvedPlanOperationTrend, ResolvedPlanOperationForecast,
		}, operation)
	case AITaskAnalyzeData:
		// rank belongs here for the same reason compare and breakdown do: "which
		// menu earns the best margin" is analysis that happens to be ordered.
		// retrieve_fact already allowed it, so excluding it here only decided the
		// outcome by which of two interchangeable labels the model picked.
		//
		// retrieve, list and detail are here for exactly that reason too. The
		// golden set labels "how much did we sell yesterday" and "what is running
		// low in stock" as analyze_data, and their natural operations are retrieve
		// and list; rejecting the pair threw away the whole plan and the user saw
		// an apology, decided by nothing but which of two labels the model chose.
		return containsValue([]ResolvedPlanOperation{
			ResolvedPlanOperationAnalyze, ResolvedPlanOperationCompare, ResolvedPlanOperationSummarize,
			ResolvedPlanOperationBreakdown, ResolvedPlanOperationTrend, ResolvedPlanOperationForecast,
			ResolvedPlanOperationRank, ResolvedPlanOperationRetrieve, ResolvedPlanOperationList,
			ResolvedPlanOperationDetail,
		}, operation)
	case AITaskRecommendAction, AITaskRestaurantAdvice:
		return operation == ResolvedPlanOperationRecommend || operation == ResolvedPlanOperationDraftAction
	case AITaskGeneralChat:
		return operation == ResolvedPlanOperationChat
	case AITaskRestaurantContent:
		return operation == ResolvedPlanOperationGenerate
	case AITaskProductHelp:
		return operation == ResolvedPlanOperationHelp || operation == ResolvedPlanOperationNavigate
	case AITaskRiskyAction:
		return operation == ResolvedPlanOperationExecuteAction || operation == ResolvedPlanOperationRefuse
	case AITaskUnclear:
		return operation == ResolvedPlanOperationClarify
	case AITaskOutOfScope:
		return operation == ResolvedPlanOperationRefuse
	default:
		return false
	}
}

func toolSupportsResolvedPlanDomain(tool AIToolName, domain ResolvedPlanDomain) bool {
	switch tool {
	case AIToolGetLowestMarginMenu, AIToolGetHighestMarginMenu, AIToolGetTopSellingMenus,
		AIToolGetLowestCostMenu, AIToolGetMenuRevenueRanking, AIToolGetSlowMovingMenus,
		AIToolGetMenuEngineering, AIToolGetMostExpensiveMenu:
		return domain == ResolvedPlanDomainMenu
	case AIToolGetLowStockIngredients, AIToolGetInventoryValuation,
		AIToolGetIngredientReorderForecast, AIToolGetDeadStock, AIToolGetTopCostIngredients:
		return domain == ResolvedPlanDomainInventory
	case AIToolGetSalesSummary, AIToolGetSalesTrend, AIToolGetAverageOrderValue,
		AIToolGetOrderTypeBreakdown, AIToolGetPeakPeriods, AIToolGetSalesForPeriod,
		AIToolGetBestSalesDay, AIToolGetProfitSummary:
		return domain == ResolvedPlanDomainSales
	case AIToolGetStoreSummary:
		return domain == ResolvedPlanDomainRestaurant
	case AIToolSearchSystemDocs, AIToolReadSystemDoc:
		return domain == ResolvedPlanDomainProduct
	default:
		return false
	}
}

func normalizeEnum(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeUniqueEnums[T ~string](values []T) []T {
	result := make([]T, 0, len(values))
	seen := make(map[T]struct{}, len(values))
	for _, value := range values {
		value = T(normalizeEnum(string(value)))
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func normalizeResolvedPlanAction(value *ResolvedPlanAction) *ResolvedPlanAction {
	if value == nil {
		return nil
	}
	result := *value
	result.Type = ResolvedPlanActionType(normalizeEnum(string(result.Type)))
	return &result
}

func normalizeEntities(values []ResolvedPlanEntityRef) []ResolvedPlanEntityRef {
	result := make([]ResolvedPlanEntityRef, 0, len(values))
	for _, value := range values {
		value.Type = ResolvedPlanEntityType(normalizeEnum(string(value.Type)))
		value.ID = strings.TrimSpace(value.ID)
		value.Name = strings.TrimSpace(value.Name)
		value.SourceTurnID = strings.TrimSpace(value.SourceTurnID)
		// Models commonly emit a placeholder entity such as {} or {"type":"menu"}
		// when the question names nothing in particular. An entity that
		// identifies nothing carries no meaning, so drop it rather than failing
		// the whole plan on it.
		if value.ID == "" && value.Name == "" && value.ResultIndex == 0 {
			continue
		}
		result = append(result, value)
	}
	return result
}

func normalizeTimeRange(value *ResolvedPlanTimeRange) *ResolvedPlanTimeRange {
	if value == nil {
		return nil
	}
	result := *value
	result.Kind = ResolvedPlanTimeRangeKind(normalizeEnum(string(result.Kind)))
	result.Label = strings.TrimSpace(result.Label)
	result.StartDate = strings.TrimSpace(result.StartDate)
	result.EndDate = strings.TrimSpace(result.EndDate)
	result.Timezone = strings.TrimSpace(result.Timezone)
	return &result
}

func normalizeDayPart(value *ResolvedPlanDayPart) *ResolvedPlanDayPart {
	if value == nil {
		return nil
	}
	result := *value
	result.Label = strings.TrimSpace(result.Label)
	return &result
}

func normalizeFilters(values []ResolvedPlanFilter) []ResolvedPlanFilter {
	result := make([]ResolvedPlanFilter, 0, len(values))
	for _, value := range values {
		value.Field = ResolvedPlanFilterField(normalizeEnum(string(value.Field)))
		value.Operator = ResolvedPlanFilterOperator(normalizeEnum(string(value.Operator)))
		value.Values = normalizeUniqueStrings(value.Values)
		result = append(result, value)
	}
	return result
}

func normalizeRanking(value *ResolvedPlanRanking) *ResolvedPlanRanking {
	if value == nil {
		return nil
	}
	result := *value
	result.Metric = ResolvedPlanMetric(normalizeEnum(string(result.Metric)))
	result.Direction = ResolvedPlanRankDirection(normalizeEnum(string(result.Direction)))
	return &result
}

// dropInheritedFromMissing removes fields that are already inherited from the
// missing list, resolving a contradiction the model can emit without changing
// the meaning of the plan.
func dropInheritedFromMissing(inherited []ResolvedPlanInheritedField, missing []ResolvedPlanField) []ResolvedPlanField {
	if len(inherited) == 0 || len(missing) == 0 {
		return missing
	}
	carried := make(map[ResolvedPlanField]struct{}, len(inherited))
	for _, field := range inherited {
		carried[field.Field] = struct{}{}
	}
	result := make([]ResolvedPlanField, 0, len(missing))
	for _, field := range missing {
		if _, exists := carried[field]; exists {
			continue
		}
		result = append(result, field)
	}
	return result
}

func normalizeInheritedFields(values []ResolvedPlanInheritedField) []ResolvedPlanInheritedField {
	result := make([]ResolvedPlanInheritedField, 0, len(values))
	for _, value := range values {
		value.Field = ResolvedPlanField(normalizeEnum(string(value.Field)))
		value.Source = ResolvedPlanContextSource(normalizeEnum(string(value.Source)))
		value.SourceTurnID = strings.TrimSpace(value.SourceTurnID)
		result = append(result, value)
	}
	return result
}

func normalizeUniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func validateUniqueEnums[T ~string](name string, values, supported []T) error {
	seen := make(map[T]struct{}, len(values))
	for _, value := range values {
		if !containsValue(supported, value) {
			return fmt.Errorf("resolved plan: unsupported %s %q", name, value)
		}
		if _, exists := seen[value]; exists {
			return fmt.Errorf("resolved plan: duplicate %s %q", name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func validateUniqueEntities(values []ResolvedPlanEntityRef) error {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		key := fmt.Sprintf("%s\x00%s\x00%s\x00%d", value.Type, value.ID, value.Name, value.ResultIndex)
		if _, exists := seen[key]; exists {
			return errors.New("resolved plan: duplicate entity reference")
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateResolvedPlanEntityProvenance(entities []ResolvedPlanEntityRef, inherited []ResolvedPlanInheritedField) error {
	inheritedSources := make(map[string]bool)
	for _, item := range inherited {
		if item.Field == ResolvedPlanFieldEntities {
			inheritedSources[item.SourceTurnID] = false
		}
	}
	for _, entity := range entities {
		if entity.SourceTurnID == "" {
			continue
		}
		if _, exists := inheritedSources[entity.SourceTurnID]; !exists {
			return fmt.Errorf("resolved plan: entity source_turn_id %q is not declared in inherited_fields", entity.SourceTurnID)
		}
		inheritedSources[entity.SourceTurnID] = true
	}
	for sourceTurnID, used := range inheritedSources {
		if !used {
			return fmt.Errorf("resolved plan: inherited entity source %q is not attached to an entity", sourceTurnID)
		}
	}
	return nil
}

func sameTimeRange(a, b ResolvedPlanTimeRange) bool {
	return a.StartDate == b.StartDate && a.EndDate == b.EndDate && a.Timezone == b.Timezone
}

func containsValue[T comparable](values []T, target T) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// impliedGroupDimensions maps the domains where a ranking has exactly one
// sensible dimension. "Which menu has the best margin" can only be grouped by
// menu, so requiring the model to restate it turned a correct plan into a
// rejection. Domains where a ranking is genuinely ambiguous — sales could be
// ranked by menu, weekday or hour — are deliberately absent, so those still have
// to say what they are ranking.
var impliedGroupDimensions = map[ResolvedPlanDomain]ResolvedPlanGroupDimension{
	ResolvedPlanDomainMenu:      ResolvedPlanGroupMenu,
	ResolvedPlanDomainInventory: ResolvedPlanGroupIngredient,
	ResolvedPlanDomainTable:     ResolvedPlanGroupTable,
	ResolvedPlanDomainStaff:     ResolvedPlanGroupStaffMember,
}

// fillImpliedGroupBy supplies the grouping a ranking or breakdown implies when
// the plan left it empty. It never overrides a stated grouping and never invents
// one for an ambiguous domain.
// qualifiedPlanFields maps the bare names models write for nested fields onto
// the qualified names the contract uses. Providers wrote "metrics" where the
// contract says "parameters.metrics" often enough to fail otherwise-correct
// plans; the two name the same field, so the short form is accepted and
// rewritten rather than rejected.
var qualifiedPlanFields = map[string]ResolvedPlanField{
	"metrics":            ResolvedPlanFieldMetrics,
	"entities":           ResolvedPlanFieldEntities,
	"time_range":         ResolvedPlanFieldTimeRange,
	"compare_time_range": ResolvedPlanFieldCompareTimeRange,
	"day_part":           ResolvedPlanFieldDayPart,
	"filters":            ResolvedPlanFieldFilters,
	"ranking":            ResolvedPlanFieldRanking,
	"group_by":           ResolvedPlanFieldGroupBy,
}

// qualifyPlanField expands a bare nested field name; anything else is returned
// unchanged so an unknown field still fails validation.
func qualifyPlanField(field ResolvedPlanField) ResolvedPlanField {
	if qualified, ok := qualifiedPlanFields[strings.TrimSpace(string(field))]; ok {
		return qualified
	}
	return field
}

// fillImpliedMetrics supplies the metric an operation states outright. A sales
// question asking for a trend is a sales_trend question whether or not the model
// also wrote the metric down, and without it the plan scores identically to a
// plain revenue total and is routed to the summary tool - which is what happened
// to "is revenue up or down against last week" in live measurement.
func fillImpliedMetrics(
	domain ResolvedPlanDomain,
	operation ResolvedPlanOperation,
	metrics []ResolvedPlanMetric,
) []ResolvedPlanMetric {
	// A summary or an analysis with no metric named is a request for the broad
	// picture, which is what overview means. Providers leave the list out for
	// exactly those two operations, and the plan was thrown away for it.
	if len(metrics) == 0 &&
		(operation == ResolvedPlanOperationSummarize || operation == ResolvedPlanOperationAnalyze) {
		return []ResolvedPlanMetric{ResolvedPlanMetricOverview}
	}
	if domain != ResolvedPlanDomainSales || operation != ResolvedPlanOperationTrend {
		return metrics
	}
	if containsValue(metrics, ResolvedPlanMetricSalesTrend) {
		return metrics
	}
	return append([]ResolvedPlanMetric{ResolvedPlanMetricSalesTrend}, metrics...)
}

func fillImpliedGroupBy(
	domain ResolvedPlanDomain,
	operation ResolvedPlanOperation,
	groupBy []ResolvedPlanGroupDimension,
) []ResolvedPlanGroupDimension {
	if len(groupBy) > 0 {
		return groupBy
	}
	if operation != ResolvedPlanOperationRank && operation != ResolvedPlanOperationBreakdown {
		return groupBy
	}
	implied, ok := impliedGroupDimensions[domain]
	if !ok {
		return groupBy
	}
	return []ResolvedPlanGroupDimension{implied}
}

// operationSupportsRanking lists the operations where an ordered result is part
// of the request rather than stray output. "Recommend the five ingredients with
// the fewest days left" is a recommendation that is inherently ranked, and
// rejecting it cost a correct plan from the provider; the same is true of a list
// that asks for the lowest or highest few. Operations that cannot use an order
// have their ranking dropped during Normalize instead of failing the plan.
func operationSupportsRanking(operation ResolvedPlanOperation) bool {
	switch operation {
	case ResolvedPlanOperationRank, ResolvedPlanOperationRecommend, ResolvedPlanOperationList:
		return true
	default:
		return false
	}
}
