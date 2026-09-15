export type ReportSalesDay = {
  order_date: string;
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
};

export type ReportSalesHour = {
  hour: number;
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
};

export type SalesByHourReport = {
  date: string;
  hours: ReportSalesHour[];
};

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
  summary: { revenue: number; cost: number; profit: number };
  has_more: boolean;
};

export type ReportMenuMargin = {
  menu_id: number;
  menu_name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type ReportStockRisk = {
  id: number;
  name: string;
  category: string;
  stock: number;
  min_stock: number;
  unit: string;
  restock_estimate: number;
  status: "low" | "out" | string;
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

export type ManagerReport = {
  generated_at: string;
  days: number;
  from?: string;
  to?: string;
  sales_days: ReportSalesDay[];
  menu_margins: ReportMenuMargin[];
  stock_risks: ReportStockRisk[];
  summary: {
    orders: number;
    /** Bills before discounts ("รายได้รวม"); servers from 15 Sep 2026. */
    gross_revenue?: number;
    discount?: number;
    expenses?: number;
    expense_count?: number;
    operating_expenses?: number;
    net_profit?: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
  };
};
