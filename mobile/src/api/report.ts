import { apiRequest } from './client';
import {
  buildManagerReportPath,
  buildManagerReportRangePath,
  buildSalesByHourPath,
  buildSalesDetailPath,
  buildTopMenuItemsPath,
  type ReportMonth,
} from '@/src/lib/report-query';
import type {
  ManagerReport,
  SalesByHourReport,
  SalesDetailReport,
  TopMenuItemsReport,
} from '@/src/types/report';

export const getManagerReport = (days = 14) =>
  apiRequest<ManagerReport>(buildManagerReportPath(days));

export const getManagerReportRange = (from: string, to: string) =>
  apiRequest<ManagerReport>(buildManagerReportRangePath(from, to));

export const getSalesDetail = (date: string) =>
  apiRequest<SalesDetailReport>(buildSalesDetailPath(date));

export const getSalesByHour = (date: string) =>
  apiRequest<SalesByHourReport>(buildSalesByHourPath(date));

export const getTopMenuItemsByMonth = (month: ReportMonth) =>
  apiRequest<TopMenuItemsReport>(buildTopMenuItemsPath(month));
