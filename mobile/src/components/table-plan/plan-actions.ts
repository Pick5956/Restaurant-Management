import {
  bulkCreateTables,
  createTableZone,
  deleteTable,
  deleteTableZone,
  moveTableZone,
  regenerateTableCustomerToken,
  updateTable,
  updateTableZone,
} from '@/src/api/table';
import { tableFailure, type TableAction, type TableFailure } from '@/src/lib/table-error';
import type { BulkCreateTablesInput, RestaurantTableInput, TableZoneInput } from '@/src/types/table';

// Every change table management makes to the server goes through here, and
// every one of them comes back as an outcome: the value, or the failure mapped
// by tableFailure into the app's own Thai/English. The API's English never
// reaches a screen, because nothing past this file ever holds the raw error.
// table-management-guards.test.mjs keeps it that way: no other file in the
// section may call a mutation, and every call here sits inside `attempt`.

export type Attempt<T> = { ok: true; value: T } | { ok: false; failure: TableFailure };

type Language = 'th' | 'en';

async function attempt<T>(action: TableAction, language: Language, run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, failure: tableFailure(error, action, language) };
  }
}

export type TablePlanApi = ReturnType<typeof tablePlanApi>;

export function tablePlanApi(language: Language) {
  return {
    addTables: (input: BulkCreateTablesInput) => attempt('add', language, () => bulkCreateTables(input)),
    saveTable: (id: number, input: RestaurantTableInput) => attempt('save', language, () => updateTable(id, input)),
    moveTable: (id: number, zoneId: number | null) => attempt('move', language, () => moveTableZone(id, { zone_id: zoneId })),
    removeTable: (id: number) => attempt('delete', language, () => deleteTable(id)),
    regenerateQr: (id: number) => attempt('regenerate', language, () => regenerateTableCustomerToken(id)),
    createZone: (input: TableZoneInput) => attempt('zone_save', language, () => createTableZone(input)),
    saveZone: (id: number, input: TableZoneInput) => attempt('zone_save', language, () => updateTableZone(id, input)),
    reorderZone: (id: number, input: TableZoneInput) => attempt('zone_reorder', language, () => updateTableZone(id, input)),
    removeZone: (id: number) => attempt('zone_delete', language, () => deleteTableZone(id)),
  };
}
