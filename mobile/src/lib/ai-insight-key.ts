import type { AIInsight } from '@/src/types/ai';

// Which proactive insight is which, for the "seen" list the assistant keeps per
// owner and restaurant. Lifted out of components/ai/insights-sheet.tsx so the
// hub can count unseen insights without importing the sheet and the assistant's
// module graph behind it; the sheet re-exports it, so its callers are unchanged.

export function insightKey(insight: Pick<AIInsight, 'kind' | 'title' | 'metric'>): string {
  return `${insight.kind}|${insight.title}|${insight.metric}`;
}
