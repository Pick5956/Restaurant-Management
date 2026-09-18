import { apiClient } from "./apiClient";
import type {
  ManagerReport,
  SalesByHourReport,
  SalesDetailReport,
  TopMenuItemsReport,
} from "../types/report";

export const getManagerReport = (days = 14) =>
  apiClient.get<ManagerReport>("/api/v1/reports/manager", { params: { days } });

/** A chosen period, both days inclusive (YYYY-MM-DD). */
export const getManagerReportRange = (from: string, to: string) =>
  apiClient.get<ManagerReport>("/api/v1/reports/manager", { params: { from, to } });

export const getSalesByHour = (date: string) =>
  apiClient.get<SalesByHourReport>("/api/v1/reports/sales-by-hour", { params: { date } });

// `hour` omitted resolves a whole-day bar (the day and month views plot days).
// axios drops undefined params on its own, so no need to branch on it here.
export const getSalesDetail = (date: string, hour?: number) =>
  apiClient.get<SalesDetailReport>("/api/v1/reports/sales-detail", { params: { date, hour } });

export const getTopMenuItemsByMonth = (year: number, month: number) =>
  apiClient.get<TopMenuItemsReport>("/api/v1/reports/top-menu-items", {
    params: { year, month },
  });
