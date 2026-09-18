export type ManagerReport = {
  generated_at: string;
  days: number;
  /** First and last calendar day covered (servers from 15 Sep 2026 on). */
  from?: string;
  to?: string;
  /** Quantity sold per menu over the same days, most first. */
  top_menu_items?: ReportTopMenuItem[];
  sales_days: Array<{ order_date: string; orders: number; revenue: number; cost: number; profit: number }>;
  menu_margins: Array<{ menu_id: number; menu_name: string; quantity: number; revenue: number; cost: number; profit: number; margin: number }>;
  stock_risks: Array<{ id: number; name: string; category: string; stock: number; min_stock: number; unit: string; restock_estimate: number; status: 'low' | 'out' | string }>;
  /** gross_revenue and discount arrive from servers built on or after 15 Sep 2026. */
  summary: { orders: number; gross_revenue?: number; discount?: number; expenses?: number; expense_count?: number; operating_expenses?: number; net_profit?: number; revenue: number; cost: number; profit: number; margin: number };
};

export type ReportSalesHour = { hour: number; orders: number; revenue: number; cost: number; profit: number };

export type SalesByHourReport = { date: string; hours: ReportSalesHour[] };

export type ReportSalesDetailOrder = {
  order_id: number;
  order_number: string;
  order_type: string;
  table_label: string;
  customer_name: string;
  completed_at: string;
  revenue: number;
  cost: number;
  profit: number;
};

export type SalesDetailReport = {
  date: string;
  hour: number | null;
  orders: ReportSalesDetailOrder[];
  summary: { orders?: number; revenue: number; cost: number; profit: number };
  has_more: boolean;
};

export type ReportTopMenuItem = {
  menu_id: number;
  menu_name: string;
  quantity: number;
};

export type TopMenuItemsReport = {
  year: number;
  month: number;
  items: ReportTopMenuItem[];
};
