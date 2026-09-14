export type AIConversationMessage = { id?: string; role: 'user' | 'assistant'; content: string };
export type AIAskRequest = {
  question: string;
  history: AIConversationMessage[];
  conversation_id?: string;
};
export type AIActionPreview = {
  id: string;
  action_type: 'set_menu_availability';
  status: string;
  expires_at: string;
  confirmation_token: string;
  summary: string;
  target: { menu_item_id: number; name: string };
  current: { is_available: boolean };
  requested: { is_available: boolean };
  warnings: string[];
};
export type AIActionConfirmationRequest = { confirmation_token: string };
export type AIActionConfirmation = {
  action_id: string;
  status: string;
  replayed: boolean;
  executed_at: string;
  message: string;
  result: { menu_item_id: number; name: string; is_available: boolean };
};

// A multi-item change waiting for one confirmation. Its figures are computed in
// Go; the card only draws them. Same shape the web's InlineDbConfirmBar takes.
export type AIActionPlanItem = {
  title: string;
  change: string;
  unit?: string;
  side_effects?: string[];
  /** The change in parts, for the confirm card's layout (backend 14 Sep 2026). */
  kind?: string;
  field?: string;
  from?: string;
  to?: string;
  value_unit?: string;
  delta?: string;
  facts?: { label: string; value: string }[];
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
export type AIActionPlanItemOutcome = { title: string; succeeded: boolean; error?: string };
export type AIActionPlanConfirmation = {
  plan_id: string;
  status: string;
  replayed: boolean;
  message: string;
  succeeded: number;
  failed: number;
  items: AIActionPlanItemOutcome[];
};

export type AISnapshot = {
  generated_at: string;
  analysis_readiness: {
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
  inventory_summary: { total_items: number; low_items: number; out_items: number; value: number };
  sales_days: Array<{ order_date: string; orders: number; revenue: number }>;
  top_menu_items: Array<{ menu_name: string; quantity: number; revenue: number }>;
  menu_margins: Array<{ menu_name: string; quantity: number; revenue: number; cost: number; profit: number; margin: number }>;
  low_margin_menus: Array<{ menu_name: string; quantity: number; revenue: number; cost: number; profit: number; margin: number }>;
  stock_risks: Array<{
    name: string;
    category: string;
    stock: number;
    min_stock: number;
    unit: string;
    storage_type: string;
    cost_per_unit: number;
    restock_estimate: number;
    status: 'low' | 'out' | 'ok' | string;
  }>;
};

// A chart the backend computed. The numbers are the answer's own; everything
// after `series` is a drawing hint (what to emphasise, what to fade and why, a
// line to compare against) and never carries a figure the text does not.
export type AIChartSeries = {
  name?: string;
  values: number[];
  // "tooltip": not drawn, shown on tap as a breakdown.
  role?: 'tooltip' | '';
  // 1-based slot in the categorical palette, when the series' colour carries meaning.
  tone?: number;
};
export type AIChartData = {
  kind: 'bar' | 'line' | 'pie';
  title: string;
  unit?: string;
  categories: string[];
  series: AIChartSeries[];
  layout?: 'horizontal';
  compare?: boolean;
  stacked?: boolean;
  share?: boolean;
  highlight?: number[];
  muted?: number[];
  muted_label?: string;
  status?: ('critical' | 'warning' | 'good' | '')[];
  notes?: string[];
  reference?: { value: number; label: string };
};

export type AINavigation = { href: string; label: string };

export type AIAskResponse = {
  answer: string;
  intent: 'analysis' | 'greeting' | 'capabilities' | 'conversation' | 'unclear' | 'out_of_scope' | string;
  task?: 'explain_concept' | 'retrieve_fact' | 'analyze_data' | 'recommend_action' | 'product_help' | string;
  tool?: 'get_lowest_margin_menu' | string;
  model: string;
  snapshot: AISnapshot;
  scope_assumed?: boolean;
  chart?: AIChartData;
  conversation_id?: string;
  turn_id?: string;
  action_preview?: AIActionPreview;
  action_plan?: AIActionPlan;
  tools_used?: string[];
  // Questions the model suggested asking next, in the owner's words.
  follow_ups?: string[];
  // The page a how-to answer was about, checked by the server against the handbook.
  navigate?: AINavigation;
};

// One row of the chat list. trashed_at is set only on rows read from the trash.
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
// answer needed on screen (chart, follow-ups, navigate) exactly as the server kept it.
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

export type AIInsightSeverity = 'critical' | 'warning' | 'info';
export type AIInsightItem = { name: string; title: string; detail: string };
export type AIInsight = {
  kind: string;
  severity: AIInsightSeverity;
  title: string;
  metric: string;
  detail: string;
  items?: AIInsightItem[];
  more?: number;
};

export type AIReceiptDraft = {
  category: 'ingredient' | 'labor' | 'rent' | 'utilities' | 'equipment' | 'other' | string;
  amount: number;
  spent_at: string;
  vendor: string;
  note: string;
  confidence: 'high' | 'medium' | 'low' | string;
};

// The eight kinds of change the assistant can prepare, in the order the
// settings sheet lists them. Keys match entity.AIActionType* on the backend.
export const AI_ACTION_TYPES = [
  'set_menu_availability',
  'set_menu_price',
  'create_menu_item',
  'adjust_ingredient_stock',
  'set_ingredient_min_stock',
  'set_ingredient_cost',
  'create_ingredient',
  'create_expense',
] as const;
export type AIActionType = (typeof AI_ACTION_TYPES)[number];

export const AI_INSIGHT_KINDS = ['ingredient_low', 'dead_stock', 'sales_drop', 'sales_up', 'plowhorse'] as const;
export type AIInsightKind = (typeof AI_INSIGHT_KINDS)[number];

export type AISettingsView = {
  actions_enabled: boolean;
  feature_available: boolean;
  action_types: Record<AIActionType, boolean>;
  insight_kinds: Record<AIInsightKind, boolean>;
  owner_title: string;
};
export type AISettingsPatch = {
  actions_enabled?: boolean;
  action_types?: Partial<Record<AIActionType, boolean>>;
  insight_kinds?: Partial<Record<AIInsightKind, boolean>>;
  owner_title?: string;
};
