import { Alert, type AlertButton } from 'react-native';

import type { Attempt } from '@/src/components/table-plan/plan-actions';
import { runLimited } from '@/src/lib/bulk-run';
import { bulkFailureLines, bulkResultTitle, tableFailureReason, type BulkVerb, type TableFailure } from '@/src/lib/table-error';
import { planLabel, type PlanLanguage } from '@/src/lib/table-plan';
import type { RestaurantTable } from '@/src/types/table';

// A bulk action from the selection: one request per table, a few at a time
// (a zone move one at a time), each answer applied as it lands, and one report
// at the end. A partial result names the tables left behind and why, in the
// app's words ("ย้ายได้ 4 จาก 5 โต๊ะ" / "T7 เลขซ้ำกับโต๊ะอื่น").

/** PUTs and DELETEs in flight at once. */
export const BULK_LIMIT = 4;

export type BulkResult<T> = {
  done: { table: RestaurantTable; value: T }[];
  failed: { table: RestaurantTable; failure: TableFailure }[];
};

export async function runBulk<T>(
  tables: readonly RestaurantTable[],
  limit: number,
  task: (table: RestaurantTable) => Promise<Attempt<T>>,
  onEach?: (table: RestaurantTable, outcome: Attempt<T>) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult<T>> {
  const outcomes = await runLimited(tables, limit, async (table) => {
    const outcome = await task(table);
    onEach?.(table, outcome);
    return { table, outcome };
  }, onProgress);
  const result: BulkResult<T> = { done: [], failed: [] };
  for (const { table, outcome } of outcomes) {
    if (outcome.ok) result.done.push({ table, value: outcome.value });
    else result.failed.push({ table, failure: outcome.failure });
  }
  return result;
}

/** The screen has to reload after a bulk run when any refusal says it is stale. */
export function bulkReloads(failed: BulkResult<unknown>['failed']): { plan: boolean; membership: boolean } {
  return {
    plan: failed.some(({ failure }) => failure.reload === 'plan'),
    membership: failed.some(({ failure }) => failure.reload === 'membership'),
  };
}

/** "ย้ายได้ 4 จาก 5 โต๊ะ" with the tables left behind, as a native Alert. */
export function alertBulkPartial(
  verb: BulkVerb,
  total: number,
  failed: BulkResult<unknown>['failed'],
  language: PlanLanguage,
  buttons?: AlertButton[],
) {
  const lines = bulkFailureLines(failed.map(({ table, failure }) => ({
    label: planLabel(table),
    reason: tableFailureReason(failure.code, language),
  })));
  Alert.alert(bulkResultTitle(verb, total - failed.length, total, language), lines, buttons);
}

const DONE_WORDS: Record<BulkVerb, { th: string; en: string }> = {
  close: { th: 'ปิดใช้งาน', en: 'Closed' },
  open: { th: 'เปิดใช้งาน', en: 'Opened' },
  move: { th: 'ย้าย', en: 'Moved' },
  delete: { th: 'ลบ', en: 'Deleted' },
  seats: { th: 'ตั้งที่นั่ง', en: 'Set seats on' },
};

/** What a screen reader hears after a bulk action went through: "ย้าย 5 โต๊ะแล้ว". */
export function bulkDoneWords(verb: BulkVerb, count: number, language: PlanLanguage): string {
  const words = DONE_WORDS[verb];
  if (language === 'th') return `${words.th} ${count} โต๊ะแล้ว`;
  return `${words.en} ${count} ${count === 1 ? 'table' : 'tables'}`;
}
