import { apiClient } from "./apiClient";
import type { BulkCreateTablesInput, MoveTableZoneInput, RestaurantTable, RestaurantTableInput, TableZone, TableZoneInput } from "../types/table";

export const listTables = () =>
  apiClient.get<{ tables: RestaurantTable[] }>("/api/v1/tables");

export const bulkCreateTables = (data: BulkCreateTablesInput) =>
  apiClient.post<{ tables: RestaurantTable[] }>("/api/v1/tables/bulk-create", data);

export const updateTable = (id: number, data: RestaurantTableInput) =>
  apiClient.put<RestaurantTable>(`/api/v1/tables/${id}`, data);

export const regenerateTableCustomerToken = (id: number) =>
  apiClient.post<RestaurantTable>(`/api/v1/tables/${id}/regenerate-customer-token`);

export const moveTableZone = (id: number, data: MoveTableZoneInput) =>
  apiClient.patch<RestaurantTable>(`/api/v1/tables/${id}/move-zone`, data);

export const deleteTable = (id: number) =>
  apiClient.delete(`/api/v1/tables/${id}`);

export const listTableZones = () =>
  apiClient.get<{ zones: TableZone[] }>("/api/v1/table-zones");

export const createTableZone = (data: TableZoneInput) =>
  apiClient.post<TableZone>("/api/v1/table-zones", data);

export const updateTableZone = (id: number, data: TableZoneInput) =>
  apiClient.put<TableZone>(`/api/v1/table-zones/${id}`, data);

export const deleteTableZone = (id: number) =>
  apiClient.delete(`/api/v1/table-zones/${id}`);
