"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Mail, X } from "lucide-react";
import type { Invitation, Membership } from "@/src/types/restaurant";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { Skeleton } from "@/src/components/shared/Skeleton";
import { displayUserName, formatDate, roleLabel } from "./staffPageConfig";
import { invitationLinkState, sortInvitationLinks, type InvitationLinkState } from "./staffPageUtils";

type Language = "th" | "en";

type Props = {
  invitations: Invitation[];
  members: Membership[];
  loading: boolean;
  language: Language;
  copiedToken: string;
  revokingIds: number[];
  onCopy: (token: string) => void;
  onEmail: (invitation: Invitation) => void;
  onRevoke: (invitationId: number) => void;
};

const COPY = {
  th: {
    title: "ลิงก์เชิญ",
    openCount: (n: number) => `เปิดอยู่ ${n}`,
    empty: "ยังไม่มีลิงก์เชิญ",
    anyEmail: "ไม่จำกัดอีเมล",
    expires: "หมดอายุ",
    noExpiry: "ไม่มีวันหมดอายุ",
    created: "สร้าง",
    acceptedBy: "รับโดย",
    unknownPerson: "ไม่พบชื่อผู้รับ",
    copy: "คัดลอกลิงก์",
    copied: "คัดลอกแล้ว",
    email: "ส่งอีเมล",
    revoke: "ยกเลิก",
    revoking: "กำลังยกเลิก",
    state: { open: "เปิดอยู่", accepted: "รับแล้ว", revoked: "ยกเลิกแล้ว", expired: "หมดอายุ" },
  },
  en: {
    title: "Invitation links",
    openCount: (n: number) => `${n} open`,
    empty: "No invitation links yet",
    anyEmail: "Any email",
    expires: "Expires",
    noExpiry: "No expiry",
    created: "Created",
    acceptedBy: "Accepted by",
    unknownPerson: "Unknown member",
    copy: "Copy link",
    copied: "Copied",
    email: "Email",
    revoke: "Revoke",
    revoking: "Revoking",
    state: { open: "Open", accepted: "Accepted", revoked: "Revoked", expired: "Expired" },
  },
} as const;

// Status colour is data: sky for a link still out, green once someone is in,
// grey for a link that can no longer be used.
const STATE_TONE: Record<InvitationLinkState, string> = {
  open: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  revoked: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  expired: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const ACTION =
  "ui-press inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[14px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800";

/**
 * Every invitation link the restaurant has made, open or used. Before, the page
 * listed only pending links, so a link someone had accepted simply vanished and
 * a second person handed the same link could not tell it was spent. Now each
 * row says whether it is still open and, once accepted, who took it.
 */
export default function InvitationLinks({
  invitations,
  members,
  loading,
  language,
  copiedToken,
  revokingIds,
  onCopy,
  onEmail,
  onRevoke,
}: Props) {
  const copy = COPY[language];
  // Taken once per page visit: close enough to tell an expired link apart.
  const [now] = useState(() => new Date());
  const sorted = useMemo(() => sortInvitationLinks(invitations, now), [invitations, now]);
  const openCount = sorted.filter((invitation) => invitationLinkState(invitation, now) === "open").length;
  const memberByUser = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);

  return (
    <section aria-labelledby="invitation-links-title" className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 id="invitation-links-title" className="text-[16px] font-semibold text-gray-900 dark:text-white">{copy.title}</h2>
        {!loading && sorted.length ? (
          <span className="text-[14px] tabular-nums text-gray-500 dark:text-gray-400">{copy.openCount(openCount)}</span>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-8 text-center text-[15px] text-gray-500 dark:text-gray-400">{copy.empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {sorted.map((invitation) => {
            const state = invitationLinkState(invitation, now);
            const acceptedMember = invitation.accepted_by_user_id != null ? memberByUser.get(invitation.accepted_by_user_id) : undefined;
            const revoking = revokingIds.includes(invitation.ID);
            return (
              <li
                key={invitation.ID}
                className={`grid gap-3 px-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-center ${state === "revoked" || state === "expired" ? "opacity-70" : ""}`}
              >
                <span className={`w-fit rounded-md px-2 py-1 text-[13px] font-semibold leading-none ${STATE_TONE[state]}`}>
                  {copy.state[state]}
                </span>

                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">
                    {roleLabel(invitation.role, language)}
                    <span className="font-normal text-gray-500 dark:text-gray-400">, {invitation.email || copy.anyEmail}</span>
                  </p>
                  {state === "accepted" ? (
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[14px] text-gray-700 dark:text-gray-300">
                      {acceptedMember ? (
                        <UserAvatar src={acceptedMember.user?.profile_image} name={displayUserName(acceptedMember, language)} size={20} className="h-5 w-5 shrink-0 text-[9px]" />
                      ) : null}
                      <span className="truncate">
                        {copy.acceptedBy}{" "}
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {acceptedMember ? displayUserName(acceptedMember, language) : copy.unknownPerson}
                        </span>
                        {invitation.accepted_at ? `, ${formatDate(invitation.accepted_at, language)}` : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 truncate text-[14px] text-gray-500 dark:text-gray-400">
                      {state === "open"
                        ? `${copy.expires} ${invitation.expires_at ? formatDate(invitation.expires_at, language) : copy.noExpiry}`
                        : state === "expired" && invitation.expires_at
                          ? `${copy.expires} ${formatDate(invitation.expires_at, language)}`
                          : `${copy.created} ${formatDate(invitation.CreatedAt, language)}`}
                    </p>
                  )}
                </div>

                {state === "open" ? (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button type="button" onClick={() => onCopy(invitation.token)} className={ACTION}>
                      {copiedToken === invitation.token ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                      {copiedToken === invitation.token ? copy.copied : copy.copy}
                    </button>
                    {invitation.email ? (
                      <button type="button" onClick={() => onEmail(invitation)} aria-label={copy.email} title={copy.email} className={ACTION}>
                        <Mail className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRevoke(invitation.ID)}
                      disabled={revoking}
                      className={`${ACTION} hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 dark:hover:!border-red-900/50 dark:hover:!bg-red-900/20 dark:hover:!text-red-300`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      {revoking ? copy.revoking : copy.revoke}
                    </button>
                  </div>
                ) : (
                  <span aria-hidden="true" className="hidden sm:block" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
