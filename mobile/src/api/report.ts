import { apiRequest } from './client';
import {
  buildManagerReportPath,
  buildManagerReportRangePath,
  buildSalesByHourPath,
  buildTopMenuItemsPath,
  type ReportMonth,
} from '@/src/lib/report-query';
import type {
  ManagerReport,
  SalesByHourReport,
  TopMenuItemsReport,
} from '@/src/types/report';

export const getManagerReport = (days = 14) =>
  apiRequest<ManagerReport>(buildManagerReportPath(days));

export const getManagerReportRange = (from: string, to: string) =>
  apiRequest<ManagerReport>(buildManagerReportRangePath(from, to));

export const getSalesByHour = (date: string) =>
  apiRequest<SalesByHourReport>(buildSalesByHourPath(date));

export const getTopMenuItemsByMonth = (month: ReportMonth) =>
  apiRequest<TopMenuItemsReport>(buildTopMenuItemsPath(month));
