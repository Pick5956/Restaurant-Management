"use client";

import Link from "next/link";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { canAccessTeam } from "@/src/lib/rbac";
import { ACTION_WIDTH, SettingsItem, settingsButtonClass } from "../_components/SettingsPrimitives";

// Invitations and roles are managed on the staff page. This page only points
// there, so settings never grows a second copy of that workflow.
export default function TeamSettingsPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { href: restaurantPageHref } = useRestaurantNav();
  const allowed = canAccessTeam(activeMembership);
  const copy = language === "th"
    ? {
        denied: "บัญชีนี้ยังไม่มีสิทธิ์จัดการทีม",
        staff: "พนักงานและสิทธิ์",
        staffHint: "เชิญพนักงานใหม่ กำหนดตำแหน่ง และปรับสิทธิ์ของแต่ละคน ทำได้ที่หน้าพนักงาน",
        open: "เปิดหน้าพนักงาน",
      }
    : {
        denied: "This account does not have team-management permission.",
        staff: "Staff and permissions",
        staffHint: "Invite new staff, set their roles and adjust what each person can do on the staff page.",
        open: "Open staff page",
      };

  if (!allowed) return <PermissionDenied title={copy.denied} />;

  return (
    <SettingsItem title={copy.staff} description={copy.staffHint}>
      <Link href={restaurantPageHref("/staff")} className={settingsButtonClass("secondary", ACTION_WIDTH)}>
        {copy.open}
      </Link>
    </SettingsItem>
  );
}
