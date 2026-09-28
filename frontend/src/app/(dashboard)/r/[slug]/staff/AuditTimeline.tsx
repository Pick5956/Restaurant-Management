"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { History, KeyRound, Link2, Link2Off, Shield, Sparkles, UserCog, UserPlus, X } from "lucide-react";
import type { RestaurantAuditLog } from "@/src/types/restaurant";
import type { User } from "@/src/types/auth";
import { Skeleton } from "@/src/components/shared/Skeleton";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useDialogFocus } from "@/src/hooks/useDialogFocus";
import { actorName, auditMessage } from "./staffPageConfig";

type Language = "th" | "en";

type Props = {
  logs: RestaurantAuditLog[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  language: Language;
  closing: boolean;
  onLoadMore: () => void;
  onClose: () => void;
};

const COPY = {
  th: { title: "ประวัติทีม", close: "ปิด", empty: "ยังไม่มีประวัติ", today: "วันนี้", yesterday: "เมื่อวาน", of: "ของ", more: "ดูเพิ่ม", loadingMore: "กำลังโหลด..." },
  en: { title: "Team history", close: "Close", empty: "No history yet", today: "Today", yesterday: "Yesterday", of: "for", more: "Show more", loadingMore: "Loading..." },
} as const;

const ACTION_ICON: Record<string, LucideIcon> = {
  invitation_created: Link2,
  invitation_revoked: Link2Off,
  invitation_accepted: UserPlus,
  member_status_changed: UserCog,
  member_role_changed: UserCog,
  member_permissions_changed: KeyRound,
  role_created: Shield,
  role_renamed: Shield,
  role_deleted: Shield,
  role_permissions_changed: KeyRound,
  ai_set_menu_availability: Sparkles,
  ai_action_plan_item: Sparkles,
};

function personName(user: User | undefined, language: Language) {
  if (!user) return language === "th" ? "ไม่ทราบชื่อ" : "Unknown";
  if (user.nickname?.trim()) return user.nickname.trim();
  const parts = [user.first_name, user.last_name].map((part) => part?.trim()).filter((part) => part && part !== "-");
  return parts.length ? parts.join(" ") : user.email;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The team's history, opened from an icon on the staff page's toolbar rather
 * than taking a section of the page: it is a few short lines most days
 * (owner, 28 ก.ย. 2569). A timeline, one group per day; each row gives the
 * time, the kind of change and a sentence that starts with who did it.
 */
export default function AuditHistoryDialog({ logs, loading, hasMore, loadingMore, language, closing, onLoadMore, onClose }: Props) {
  const copy = COPY[language];
  const locale = language === "th" ? "th-TH" : "en-US";
  const [today] = useState(() => new Date());
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropClose(onClose);
  useDialogFocus({ open: true, containerRef: dialogRef, onEscape: onClose });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const groups = useMemo(() => {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const result: { key: string; label: string; logs: RestaurantAuditLog[] }[] = [];
    for (const log of logs) {
      const at = log.CreatedAt ? new Date(log.CreatedAt) : null;
      const valid = at && !Number.isNaN(at.getTime()) ? at : null;
      const key = valid ? dayKey(valid) : "unknown";
      const label = !valid
        ? "-"
        : key === dayKey(today)
          ? copy.today
          : key === dayKey(yesterday)
            ? copy.yesterday
            : valid.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
      const last = result[result.length - 1];
      if (last && last.key === key) last.logs.push(log);
      else result.push({ key, label, logs: [log] });
    }
    return result;
  }, [copy.today, copy.yesterday, locale, logs, today]);

  return (
    <div
      {...backdrop}
      className={`${closing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${closing ? "motion-dialog-exit" : "motion-dialog"} flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:max-h-[min(40rem,calc(100dvh-2rem))]`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 id={titleId} className="text-[17px] font-semibold text-gray-900 dark:text-white">{copy.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="ui-press grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-3">
          {loading ? (
            <div className="space-y-3 pb-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-gray-500 dark:text-gray-400">{copy.empty}</p>
          ) : (
            <>
              {groups.map((group) => (
                <div key={group.key} className="pb-3">
                  <p className="pb-1.5 text-[13px] font-semibold text-gray-500 dark:text-gray-400">{group.label}</p>
                  {/* A hairline runs down the icon column and ties a day's
                      changes together; each icon masks it with the dialog's
                      own background. */}
                  <ol className={`relative ${group.logs.length > 1 ? "before:absolute before:bottom-6 before:left-[4.5rem] before:top-4 before:w-px before:bg-gray-200 dark:before:bg-gray-800" : ""}`}>
                    {group.logs.map((log) => {
                      const Icon = ACTION_ICON[log.action] ?? History;
                      const at = log.CreatedAt ? new Date(log.CreatedAt) : null;
                      const time = at && !Number.isNaN(at.getTime())
                        ? at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
                        : "-";
                      const target = log.target_user && log.target_user_id !== log.actor_user_id ? log.target_user : undefined;
                      return (
                        <li key={log.ID} className="relative grid grid-cols-[3rem_1.5rem_minmax(0,1fr)] items-start gap-x-3 py-2">
                          <time dateTime={log.CreatedAt} className="text-right text-[14px] leading-6 tabular-nums text-gray-500 dark:text-gray-400">
                            {time}
                          </time>
                          <span className="relative grid h-6 w-6 place-items-center bg-white text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                          </span>
                          <p className="min-w-0 break-words text-[15px] leading-6 text-gray-700 dark:text-gray-300">
                            <span className="font-semibold text-gray-900 dark:text-white">{actorName(log, language)}</span>{" "}
                            {auditMessage(log, language)}
                            {target ? (
                              <>
                                {` ${copy.of} `}
                                <span className="font-semibold text-gray-900 dark:text-white">{personName(target, language)}</span>
                              </>
                            ) : null}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
              {hasMore ? (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="ui-press mb-2 h-10 w-full rounded-md text-[14px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {loadingMore ? copy.loadingMore : copy.more}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
