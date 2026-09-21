import { apiRequest } from './client';
import type {
  BulkCreateTablesInput,
  MoveTableZoneInput,
  RestaurantTable,
  RestaurantTableInput,
  TableZone,
  TableZoneInput,
} from '@/src/types/table';

export function listTables() {
  return apiRequest<{ tables: RestaurantTable[] }>('/api/v1/tables');
}

export function bulkCreateTables(data: BulkCreateTablesInput) {
  return apiRequest<{ tables: RestaurantTable[] }>('/api/v1/tables/bulk-create', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTable(id: number, data: RestaurantTableInput) {
  return apiRequest<RestaurantTable>(`/api/v1/tables/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTable(id: number) {
  return apiRequest<{ status: string }>(`/api/v1/tables/${id}`, {
    method: 'DELETE',
  });
}

export function regenerateTableCustomerToken(id: number) {
  return apiRequest<RestaurantTable>(`/api/v1/tables/${id}/regenerate-customer-token`, {
    method: 'POST',
  });
}

export function moveTableZone(id: number, data: MoveTableZoneInput) {
  return apiRequest<RestaurantTable>(`/api/v1/tables/${id}/move-zone`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function listTableZones() {
  return apiRequest<{ zones: TableZone[] }>('/api/v1/table-zones');
}

export function createTableZone(data: TableZoneInput) {
  return apiRequest<TableZone>('/api/v1/table-zones', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTableZone(id: number, data: TableZoneInput) {
  return apiRequest<TableZone>(`/api/v1/table-zones/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTableZone(id: number) {
  return apiRequest<{ status: string }>(`/api/v1/table-zones/${id}`, {
    method: 'DELETE',
  });
}
