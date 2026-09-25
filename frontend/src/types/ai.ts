export type AISalesSummary = {
  order_date: string;
  orders: number;
  revenue: number;
};

export type AIInsightSeverity = "critical" | "warning" | "info";

export type AIInsightItem = {
  /** The bare thing, for the collapsed preview ("ไก่สับ"). */
  name: string;
  /** The thing plus its situation, for the opened list. */
  title: string;
  detail: string;
};

export type AIInsight = {
  kind: string;
  severity: AIInsightSeverity;
  title: string;
  metric: string;
  detail: string;
  /** Set when several facts of one kind are folded into a single card. */
  items?: AIInsightItem[];
  /** Rows the card could not list, so the count is never understated. */
  more?: number;
};
export type AIMenuSummary = {
  menu_name: string;
  quantity: number;
  revenue: number;
};

export type AIMenuMarginSummary = {
  menu_name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type AIInventorySummary = {
  total_items: number;
  low_items: number;
  out_items: number;
  value: number;
};

export type AIAnalysisReadiness = {
  has_sales: boolean;
  sales_items: number;
  margin_items: number;
  costed_margin_items: number;
  sold_menus: number;
  sold_menus_with_recipes: number;
  margin_cost_coverage_percent: number;
  menu_recipe_coverage_percent: number;
  can_analyze_revenue: boolean;
  can_analyze_margin: boolean;
  can_recommend_business_actions: boolean;
  warnings: string[];
};

export type AIStockRisk = {
  name: string;
  category: string;
  stock: number;
  min_stock: number;
  unit: string;
  storage_type: string;
  cost_per_unit: number;
  restock_estimate: number;
  status: "low" | "out" | "ok" | string;
};

export type AISnapshot = {
  generated_at: string;
  sales_days: AISalesSummary[];
  top_menu_items: AIMenuSummary[];
  menu_margins: AIMenuMarginSummary[];
  low_margin_menus: AIMenuMarginSummary[];
  analysis_readiness: AIAnalysisReadiness;
  inventory_summary: AIInventorySummary;
  stock_risks: AIStockRisk[];
};

export type AIConversationMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

export type AIAskRequest = {
  question: string;
  history: AIConversationMessage[];
  conversation_id?: string;
  /** This client draws the step-by-step card for a new ingredient
   * (AIIngredientSetupCard), so the server sends the card instead of asking
   * the unit in the chat first. */
  ingredient_card?: boolean;
};

export type AIResolvedPlan = {
  schema_version: string;
  original_question: string;
  resolved_question: string;
  task: string;
  domain: string;
  operation: string;
  action: {
    type: "set_menu_availability";
    arguments: { is_available: boolean };
  } | null;
  parameters: Record<string, unknown>;
  tool_hint: string;
  resolution: Record<string, unknown>;
  policy: Record<string, unknown>;
  response_style: string;
};

export type AIActionPreview = {
  id: string;
  action_type: "set_menu_availability";
  status: string;
  expires_at: string;
  confirmation_token: string;
  summary: string;
  target: {
    menu_item_id: number;
    name: string;
  };
  current: {
    is_available: boolean;
  };
  requested: {
    is_available: boolean;
  };
  warnings: string[];
};

export type AIActionConfirmation = {
  action_id: string;
  status: string;
  replayed: boolean;
  executed_at: string;
  message: string;
  result: {
    menu_item_id: number;
    name: string;
    is_available: boolean;
  };
};

// One row of the chat list. turn_count is the number of exchanges; trashed_at
// is set only on rows read from the trash.
export type AIConversationSummary = {
  id: string;
  title: string;
  title_by_owner: boolean;
  turn_count: number;
  created_at: string;
  updated_at: string;
  trashed_at?: string | null;
};

// One stored exchange, read back to reopen a chat. display carries what the
// answer needed on screen (chart, forecast, tools) exactly as the server kept it.
export type AIConversationTurn = {
  id: string;
  sequence: number;
  question: string;
  answer: string;
  tool?: string;
  latency_ms: number;
  created_at: string;
  display: Record<string, unknown>;
};

export type AISystemDocSource = {
  article_slug: string;
  section_id: string;
  article_title: string;
  section_title: string;
  relevant_content?: string;
  url: `/docs#${string}` | `/docs/${string}#${string}`;
};

export type AIForecastResult = {
  history: { date: string; actual: number }[];
  forecast: { date: string; weekday: string; predicted: number; lower: number; upper: number }[];
  mape: number;
  mae: number;
  backtest_n: number;
  sample_days: number;
  stale_days: number;
};

// A chart the backend computed. The numbers are the answer's own; everything
// after `series` is a drawing hint (what to emphasise, what to fade and why, a
// line to compare against) and never carries a figure the text does not.
export type AIChartData = {
  kind: "bar" | "line" | "pie" | "stocklist";
  title: string;
  unit?: string;
  categories: string[];
  /** One unit per category, for a list whose rows do not share one. */
  units?: string[];
  series: AIChartSeries[];
  layout?: "horizontal";
  compare?: boolean;
  stacked?: boolean;
  share?: boolean;
  highlight?: number[];
  muted?: number[];
  muted_label?: string;
  status?: ("critical" | "warning" | "good" | "")[];
  notes?: string[];
  reference?: { value: number; label: string };
};

export type AIChartSeries = {
  name?: string;
  values: number[];
  // "tooltip": not drawn, shown on hover as a breakdown.
  role?: "tooltip" | "";
  // 1-based slot in the categorical palette, when the series' colour carries
  // meaning (cost / expenses / what is left).
  tone?: number;
};

// A multi-item change waiting for one confirmation. Its figures are computed in
// Go; the bar only draws them.
export type AIActionPlanItem = {
  title: string;
  change: string;
  unit?: string;
  side_effects?: string[];
  kind?: string;
  facts?: { label: string; value: string }[];
  /** Set on a new ingredient the card asks about one step at a time. */
  setup?: AIIngredientSetup;
};

// The new-ingredient card's state, computed in Go (ai_ingredient_setup.go).
// The lists are the only values the server accepts.
export type AIIngredientSetup = {
  name: string;
  said_quantity: number;
  said_unit?: string;
  unit: string;
  units: string[];
  /** No amount was said, so the card asks what is on hand. */
  needs_stock: boolean;
  stock_set: boolean;
  needs_pack: boolean;
  pack_unit?: string;
  pack_units: string[];
  pack_size?: number;
  stock: number;
  /** The price modes Go accepts for this state, in the order to offer them. */
  price_modes: AIIngredientPriceMode[];
  price_mode: AIIngredientPriceMode | "";
  price?: number;
  cost_per_unit?: number;
  total?: number;
  storage_type: string;
  storage_types: string[];
  min_percent: number;
  /** What the inventory still needs; confirming is refused until empty. */
  missing?: string[];
};

export type AIIngredientPriceMode = "total" | "per_pack" | "per_unit";

// One answer from the card, sent with every answer so far.
export type AIIngredientSetupAnswers = {
  unit: string;
  /** Opening stock typed on the card; left out until answered. */
  stock?: number;
  pack_unit: string;
  pack_size: number;
  price_mode: AIIngredientPriceMode | "";
  price: number;
  storage_type: string;
  min_percent: number;
  /** The last answer: the confirm bar's minute starts here. */
  finish?: boolean;
};

export type AIActionPlan = {
  id: string;
  status: string;
  expires_at: string;
  confirmation_token: string;
  summary: string;
  items: AIActionPlanItem[];
  warnings?: string[];
};

export type AIActionPlanItemOutcome = {
  title: string;
  succeeded: boolean;
  error?: string;
};

export type AIActionPlanConfirmation = {
  plan_id: string;
  status: string;
  replayed: boolean;
  message: string;
  succeeded: number;
  failed: number;
  items: AIActionPlanItemOutcome[];
};

export type AINavigation = { href: string; label: string };

export type AIAskResponse = {
  answer: string;
  intent: "analysis" | "greeting" | "capabilities" | "conversation" | "unclear" | "out_of_scope" | string;
  task?: "explain_concept" | "retrieve_fact" | "analyze_data" | "recommend_action" | "product_help" | string;
  tool?: "get_lowest_margin_menu" | string;
  model: string;
  snapshot: AISnapshot;
  // True when the answer covers a default time window the user did not ask for
  // (e.g. "ยอดขายเท่าไหร่" → last 30 days). Drives the period-pivot chips.
  scope_assumed?: boolean;
  // Chart-ready sales forecast when the question asked for one.
  forecast?: AIForecastResult;
  // General chart payload (bar/line/pie) when the answer is best shown as a
  // picture — e.g. a two-period sales comparison.
  chart?: AIChartData;
  conversation_id?: string;
  turn_id?: string;
  resolved_plan?: AIResolvedPlan;
  action_preview?: AIActionPreview;
  action_plan?: AIActionPlan;
  candidate_tools?: string[];
  tools_used?: string[];
  doc_sources?: AISystemDocSource[];
  // Questions the model suggested asking next, in the owner's words. Shown as
  // chips under the answer; a tap sends the text verbatim.
  follow_ups?: string[];
  // The page a how-to answer was about, checked by the server against the
  // handbook. Shown as a "take me there" chip.
  navigate?: AINavigation;
  planner?: {
    provider: "groq" | "gemini" | "local_clarification_fallback" | string;
    model?: string;
    provider_fallback: boolean;
    local_fallback: boolean;
    attempt_count: number;
  };
};
