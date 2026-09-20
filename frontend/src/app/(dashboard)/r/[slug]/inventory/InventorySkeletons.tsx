"use client";

import { Skeleton } from "@/src/components/shared/Skeleton";

// Loading shapes for the inventory screen (19 ก.ย. 2569). The first load used
// to show a restaurant card's outline — a cover image and a logo, nothing like
// this page — and the history tab showed the word "กำลังโหลด…" in an empty
// table. These take the shape of what is coming: the toolbar, the column
// titles, and rows whose bones sit where each column's text will.

const nameWidths = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28", "w-24", "w-36"];

/** Rows for a table body while its data loads, one bone per column. */
export function InventoryHistoryRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr key={index} aria-hidden="true">
          <td className="px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3 w-9" />
            </div>
          </td>
          <td className="px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Skeleton className={`h-3.5 ${nameWidths[index % nameWidths.length]}`} />
              <Skeleton className="h-3 w-12" />
            </div>
          </td>
          <td className="px-4 py-3.5">
            <Skeleton className="h-6 w-14 rounded-full" />
          </td>
          <td className="px-4 py-3.5">
            <Skeleton className="ml-auto h-3.5 w-16" />
          </td>
          <td className="px-4 py-3.5">
            <Skeleton className="ml-auto h-3.5 w-14" />
          </td>
          <td className="px-4 py-3.5">
            <Skeleton className="h-3.5 w-24" />
          </td>
          <td className="px-4 py-3.5">
            <Skeleton className="h-3.5 w-40" />
          </td>
        </tr>
      ))}
    </>
  );
}

/** The whole screen on first load: toolbar, then the stock table. */
export function InventoryPageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="min-h-dvh bg-slate-100 px-4 pb-6 pt-4 dark:bg-gray-950 sm:px-6 lg:px-8">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64 rounded-xl" />
        <Skeleton className="h-9 w-24 rounded-xl" />
        <Skeleton className="h-9 w-56 rounded-xl" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-28 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <div aria-hidden="true" className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-6 border-b border-slate-100 px-4 py-3 dark:border-gray-800">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <div className="flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: 9 }).map((_, index) => (
          <div key={index} className="flex items-center gap-6 border-b border-slate-100 px-4 py-4 last:border-b-0 dark:border-gray-800">
            <Skeleton className={`h-3.5 ${nameWidths[index % nameWidths.length]}`} />
            <div className="w-44 space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-1.5 w-44 rounded-full" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
