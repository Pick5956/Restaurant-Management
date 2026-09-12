package service

import (
	"errors"
	"fmt"
	"sort"
	"time"
)

const maxResolvedPlanCandidateTools = 5

// AIActorContext is populated by authenticated backend middleware. Values in a
// model response or request body must never be copied into this structure.
type AIActorContext struct {
	RestaurantID uint
	OwnerUserID  uint
	Role         string
}

// AICapabilityDecision is the execution boundary between an untrusted plan and
// deterministic repository code. CandidateTools is deliberately capped so a
// later provider call never receives the entire tool catalogue.
type AICapabilityDecision struct {
	CandidateTools []AIToolName
	SelectedTool   AIToolName
	ReadOnly       bool
}

type aiReadCapability struct {
	Tool    AIToolName
	Domain  ResolvedPlanDomain
	Metrics []ResolvedPlanMetric
	Order   int
	// Direction is set only where two tools read the same metric from opposite
	// ends: best sellers against slow movers, best margin against worst. Without
	// it the two are scored identically and the one listed first always wins, so
	// "which dish has the worst margin" could not be answered at all.
	Direction ResolvedPlanRankDirection
	// Operation is the question shape this tool is built to answer. Several tools
	// in a domain read the same metric and differ only in what is being asked of
	// it: revenue summarised for a period, revenue retrieved for one day, revenue
	// compared over time. Without it the first tool listed answered all three.
	Operation ResolvedPlanOperation
}

var aiReadCapabilities = []aiReadCapability{
	// Public documentation tools read the embedded catalog only. They never
	// receive a restaurant ID or act as authorization for a write operation.
	{AIToolSearchSystemDocs, ResolvedPlanDomainProduct, nil, 0, "", ""},
	{AIToolReadSystemDoc, ResolvedPlanDomainProduct, nil, 1, "", ""},

	{AIToolGetStoreSummary, ResolvedPlanDomainRestaurant, []ResolvedPlanMetric{ResolvedPlanMetricOverview}, 0, "", ResolvedPlanOperationSummarize},

	{AIToolGetSalesSummary, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricOverview, ResolvedPlanMetricRevenue, ResolvedPlanMetricOrderCount}, 0, "", ResolvedPlanOperationSummarize},
	{AIToolGetSalesForPeriod, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricRevenue, ResolvedPlanMetricOrderCount, ResolvedPlanMetricDataCoverage}, 1, "", ResolvedPlanOperationRetrieve},
	{AIToolGetSalesTrend, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricSalesTrend, ResolvedPlanMetricRevenue}, 2, "", ResolvedPlanOperationTrend},
	{AIToolGetAverageOrderValue, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricAverageOrder}, 3, "", ResolvedPlanOperationRetrieve},
	{AIToolGetOrderTypeBreakdown, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricOrderTypeShare, ResolvedPlanMetricRevenue, ResolvedPlanMetricOrderCount}, 4, "", ResolvedPlanOperationBreakdown},
	{AIToolGetPeakPeriods, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricPeakPeriod}, 5, "", ResolvedPlanOperationBreakdown},
	{AIToolGetBestSalesDay, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricRevenue, ResolvedPlanMetricOrderCount}, 6, "", ResolvedPlanOperationRetrieve},
	// Store-level profit is revenue minus cost summarised across the whole store,
	// so it sits in sales beside the revenue summary and is told apart from it by
	// carrying the profit / margin / cost metrics the revenue summary does not.
	{AIToolGetProfitSummary, ResolvedPlanDomainSales, []ResolvedPlanMetric{ResolvedPlanMetricProfit, ResolvedPlanMetricMargin, ResolvedPlanMetricCost, ResolvedPlanMetricRevenue}, 6, "", ResolvedPlanOperationSummarize},

	{AIToolGetTopSellingMenus, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricQuantity, ResolvedPlanMetricOverview}, 0, ResolvedPlanRankHigh, ResolvedPlanOperationRank},
	{AIToolGetMenuRevenueRanking, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricRevenue}, 1, "", ResolvedPlanOperationRank},
	{AIToolGetHighestMarginMenu, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricMargin, ResolvedPlanMetricProfit}, 2, ResolvedPlanRankHigh, ResolvedPlanOperationRank},
	{AIToolGetLowestMarginMenu, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricMargin}, 3, ResolvedPlanRankLow, ResolvedPlanOperationRank},
	{AIToolGetLowestCostMenu, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricCost}, 4, ResolvedPlanRankLow, ResolvedPlanOperationRank},
	{AIToolGetMostExpensiveMenu, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricPrice}, 5, "", ResolvedPlanOperationRank},
	{AIToolGetSlowMovingMenus, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricQuantity}, 6, ResolvedPlanRankLow, ResolvedPlanOperationRank},
	{AIToolGetMenuEngineering, ResolvedPlanDomainMenu, []ResolvedPlanMetric{ResolvedPlanMetricOverview, ResolvedPlanMetricMargin, ResolvedPlanMetricQuantity}, 7, "", ResolvedPlanOperationAnalyze},

	{AIToolGetLowStockIngredients, ResolvedPlanDomainInventory, []ResolvedPlanMetric{ResolvedPlanMetricStockLevel, ResolvedPlanMetricStatus, ResolvedPlanMetricOverview}, 0, "", ResolvedPlanOperationList},
	{AIToolGetInventoryValuation, ResolvedPlanDomainInventory, []ResolvedPlanMetric{ResolvedPlanMetricInventoryValue, ResolvedPlanMetricOverview}, 1, "", ResolvedPlanOperationRetrieve},
	{AIToolGetIngredientReorderForecast, ResolvedPlanDomainInventory, []ResolvedPlanMetric{ResolvedPlanMetricDaysLeft, ResolvedPlanMetricUsage}, 2, "", ResolvedPlanOperationForecast},
	{AIToolGetDeadStock, ResolvedPlanDomainInventory, []ResolvedPlanMetric{ResolvedPlanMetricDeadStock, ResolvedPlanMetricUsage}, 3, "", ResolvedPlanOperationList},
	{AIToolGetTopCostIngredients, ResolvedPlanDomainInventory, []ResolvedPlanMetric{ResolvedPlanMetricCost, ResolvedPlanMetricUsage}, 4, ResolvedPlanRankHigh, ResolvedPlanOperationRank},
}

// AuthorizeResolvedPlan enforces tenant, owner, read-only, argument and tool
// policy. A schema-valid ResolvedPlan alone is never permission to query data.
func AuthorizeResolvedPlan(plan ResolvedPlan, actor AIActorContext) (AICapabilityDecision, error) {
	validated, err := NormalizeAndValidateResolvedPlan(plan)
	if err != nil {
		return AICapabilityDecision{}, err
	}
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 {
		return AICapabilityDecision{}, errors.New("AI capability: authenticated restaurant owner context is required")
	}
	if actor.Role != "owner" {
		return AICapabilityDecision{}, errors.New("AI capability: only the restaurant owner may use the assistant")
	}
	if validated.Resolution.NeedsClarification || len(validated.Resolution.MissingFields) > 0 {
		return AICapabilityDecision{}, errors.New("AI capability: an incomplete plan cannot execute")
	}
	if !validated.Policy.ReadOnly || validated.Policy.Risk != ResolvedPlanRiskLow {
		return AICapabilityDecision{}, errors.New("AI capability: write or elevated-risk plans require the action preview boundary")
	}
	if validated.Operation == ResolvedPlanOperationDraftAction || validated.Operation == ResolvedPlanOperationExecuteAction {
		return AICapabilityDecision{}, errors.New("AI capability: action operations are not read-only")
	}
	if err := validateResolvedPlanBusinessLimits(validated); err != nil {
		return AICapabilityDecision{}, err
	}

	candidates := CandidateToolsForResolvedPlan(validated)
	selected := validated.ToolHint
	if selected != "" && !containsAITool(candidates, selected) {
		// The hint is a suggestion, and the candidate set is derived from the
		// domain and metrics in the same plan. When the two disagree the model
		// contradicted itself; dropping the hint costs nothing, because the tool
		// is chosen from the validated fields either way and a hint has never been
		// able to reach a tool outside them. Failing instead turned a model
		// inconsistency into an error message on the user's screen.
		aiStage("warn", "planner tool_hint %q does not match domain %q — ignoring the hint",
			selected, validated.Domain)
		selected = ""
	}
	if selected == "" && len(candidates) > 0 {
		selected = candidates[0]
	}
	return AICapabilityDecision{
		CandidateTools: candidates,
		SelectedTool:   selected,
		ReadOnly:       true,
	}, nil
}

// CandidateToolsForResolvedPlan chooses at most five tools using only the
// validated domain and typed metrics. It does not trust free-form model text.
func CandidateToolsForResolvedPlan(plan ResolvedPlan) []AIToolName {
	type scoredCapability struct {
		capability aiReadCapability
		score      int
	}

	metrics := make(map[ResolvedPlanMetric]struct{}, len(plan.Parameters.Metrics))
	for _, metric := range plan.Parameters.Metrics {
		metrics[metric] = struct{}{}
	}
	scored := make([]scoredCapability, 0, maxResolvedPlanCandidateTools)
	for _, capability := range aiReadCapabilities {
		if capability.Domain != plan.Domain {
			continue
		}
		score := 10
		if capability.Tool == plan.ToolHint {
			score += 1000
		}
		for _, metric := range capability.Metrics {
			if _, ok := metrics[metric]; ok {
				score += 100
			}
		}
		// Direction and operation refine a choice the metrics already narrowed;
		// they never make a tool that reads none of the requested metrics win.
		// Ungated, "which menu earns the most" went to the best-seller tool purely
		// because that question ranks from the top.
		if score > 10 {
			// Which end of the ranking is asked for is part of the question, not
			// decoration: it is the only thing separating best sellers from slow
			// movers. It outranks one shared metric so the pair is decided by the
			// direction, and stays well below tool_hint.
			if capability.Direction != "" && plan.Parameters.Ranking != nil &&
				capability.Direction == plan.Parameters.Ranking.Direction {
				score += 150
			}
			if capability.Operation != "" && capability.Operation == plan.Operation {
				score += 150
			}
		}
		scored = append(scored, scoredCapability{capability: capability, score: score})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].capability.Order < scored[j].capability.Order
	})
	if len(scored) > maxResolvedPlanCandidateTools {
		scored = scored[:maxResolvedPlanCandidateTools]
	}
	result := make([]AIToolName, 0, len(scored))
	for _, item := range scored {
		result = append(result, item.capability.Tool)
	}
	return result
}

func validateResolvedPlanBusinessLimits(plan ResolvedPlan) error {
	for field, value := range map[string]*ResolvedPlanTimeRange{
		"time_range":         plan.Parameters.TimeRange,
		"compare_time_range": plan.Parameters.CompareTimeRange,
	} {
		if value == nil || value.Kind == ResolvedPlanTimeRangeAllTime {
			continue
		}
		start, err := time.Parse("2006-01-02", value.StartDate)
		if err != nil {
			return fmt.Errorf("AI capability: %s has invalid start date", field)
		}
		end, err := time.Parse("2006-01-02", value.EndDate)
		if err != nil {
			return fmt.Errorf("AI capability: %s has invalid end date", field)
		}
		if end.Sub(start) > 366*24*time.Hour {
			return fmt.Errorf("AI capability: %s exceeds the 366-day query limit", field)
		}
	}
	return nil
}

func containsAITool(values []AIToolName, target AIToolName) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
