"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { updateProfile, uploadProfileImage } from "@/src/lib/auth";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { roleLabel } from "@/src/lib/roleLabels";
import { Field, SettingsPanel, SettingsShell, StatusMessage } from "../_components/SettingsPrimitives";

function normalizePhone(value: string) {
  return value.replace(/[^\d+\-\s]/g, "").slice(0, 24);
}

function getDisplayName(user: ReturnType<typeof useAuth>["user"], language: Language) {
  if (!user) return language === "th" ? "ผู้ใช้งาน" : "User";
  if (user.nickname?.trim()) return user.nickname.trim();
  const parts = [user.first_name, user.last_name].map((part) => part?.trim()).filter((part) => part && part !== "-");
  return parts.length ? parts.join(" ") : user.email;
}

export default function AccountSettingsPage() {
  const { user, updateUser, memberships } = useAuth();
  const { language } = useLanguage();
  const saveOnceRef = useRef(createSingleFlight());
  const uploadOnceRef = useRef(createSingleFlight());
  const profileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", nickname: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const copy = language === "th"
    ? {
        eyebrow: "Account",
        title: "บัญชีของฉัน",
        subtitle: "แก้ข้อมูลโปรไฟล์ที่ทีมเห็น และตรวจสอบวิธีเข้าสู่ระบบของบัญชีนี้",
        back: "ตั้งค่า",
        profile: "โปรไฟล์",
        profileHint: "ชื่อเล่นจะถูกใช้ก่อนชื่อจริงใน sidebar และหน้าทีม",
        upload: "อัปโหลดรูป",
        uploading: "กำลังอัปโหลด...",
        firstName: "ชื่อ",
        lastName: "นามสกุล",
        nickname: "ชื่อเล่น",
        phone: "เบอร์โทร",
        email: "อีเมล",
        save: "บันทึกบัญชี",
        saving: "กำลังบันทึก...",
        required: "กรุณากรอกชื่อ",
        saved: "บันทึกข้อมูลบัญชีแล้ว",
        saveError: "บันทึกข้อมูลบัญชีไม่สำเร็จ",
        uploadError: "อัปโหลดรูปไม่สำเร็จ กรุณาใช้ jpg, png หรือ webp ไม่เกิน 5MB",
        linked: "บัญชีที่เชื่อมไว้",
        linkedHint: "แสดงวิธีเข้าสู่ระบบของบัญชีนี้ให้ชัดเจน",
        google: "Google",
        local: "อีเมลและรหัสผ่าน",
        connected: "เชื่อมแล้ว",
        notConnected: "ยังไม่เชื่อม",
        places: "ร้านที่คุณอยู่",
        placesHint: "ทุกร้านที่บัญชีนี้เป็นสมาชิก พร้อมบทบาทในแต่ละร้าน",
        joined: "เข้าร่วมเมื่อ",
        active: "ใช้งานอยู่",
        suspended: "ถูกระงับ",
        noPlaces: "ยังไม่ได้เป็นสมาชิกร้านไหน",
      }
    : {
        eyebrow: "Account",
        title: "My account",
        subtitle: "Edit the profile details your team sees and review how this account signs in.",
        back: "Settings",
        profile: "Profile",
        profileHint: "Nickname appears before your legal name in the sidebar and team screens.",
        upload: "Upload photo",
        uploading: "Uploading...",
        firstName: "First name",
        lastName: "Last name",
        nickname: "Nickname",
        phone: "Phone",
        email: "Email",
        save: "Save account",
        saving: "Saving...",
        required: "Please enter your first name.",
        saved: "Account details saved.",
        saveError: "Could not save account details.",
        uploadError: "Could not upload profile photo. Use jpg, png, or webp up to 5MB.",
        linked: "Linked accounts",
        linkedHint: "Shows exactly which sign-in method this account uses.",
        google: "Google",
        local: "Email and password",
        connected: "Connected",
        notConnected: "Not connected",
        places: "Your restaurants",
        placesHint: "Every restaurant this account belongs to, with its role.",
        joined: "Joined",
        active: "Active",
        suspended: "Suspended",
        noPlaces: "Not a member of any restaurant yet.",
      };

  const displayName = getDisplayName(user, language);
  const isGoogleAccount = user?.auth_provider === "google";

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      setForm({
        first_name: user?.first_name ?? "",
        last_name: user?.last_name === "-" ? "" : user?.last_name ?? "",
        nickname: user?.nickname ?? "",
        phone: user?.phone ?? "",
      });
      setError("");
      setMessage("");
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [user]);

  const setField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (!form.first_name.trim()) {
      setError(copy.required);
      return;
    }

    await saveOnceRef.current(async () => {
      setSaving(true);
      setError("");
      setMessage("");
      try {
        const res = await updateProfile({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          nickname: form.nickname.trim(),
          phone: form.phone.trim(),
        });
        updateUser(res.data);
        setMessage(copy.saved);
      } catch {
        setError(copy.saveError);
      } finally {
        setSaving(false);
      }
    });
  };

  const uploadPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;

    await uploadOnceRef.current(async () => {
      setUploading(true);
      setError("");
      setMessage("");
      try {
        const res = await uploadProfileImage(file);
        updateUser(res.data);
        setMessage(copy.saved);
      } catch {
        setError(copy.uploadError);
      } finally {
        setUploading(false);
      }
    });
  };

  return (
    <SettingsShell eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} backLabel={copy.back} hideHeader>
      <div className="grid gap-4">
        <form onSubmit={saveProfile} className="space-y-4">
          <SettingsPanel title={copy.profile} hint={copy.profileHint}>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <UserAvatar src={user?.profile_image} name={displayName} size={64} className="h-16 w-16 text-lg" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">{displayName}</p>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">{user?.email ?? ""}</p>
                </div>
              </div>
              <input ref={profileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadPhoto} />
              <button type="button" onClick={() => profileInputRef.current?.click()} disabled={!user || uploading} className="ui-press h-11 rounded-md border border-gray-200 px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800 sm:h-10">
                {uploading ? copy.uploading : copy.upload}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy.nickname} value={form.nickname} onChange={(value) => setField("nickname", value)} />
              <Field label={copy.phone} value={form.phone} onChange={(value) => setField("phone", normalizePhone(value))} inputMode="tel" />
              <Field label={copy.firstName} value={form.first_name} onChange={(value) => setField("first_name", value)} error={error === copy.required ? error : undefined} />
              <Field label={copy.lastName} value={form.last_name} onChange={(value) => setField("last_name", value)} />
              <div className="sm:col-span-2">
                <Field label={copy.email} value={user?.email ?? ""} />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <StatusMessage error={error && error !== copy.required ? error : undefined} message={message} />
              <button type="submit" disabled={!user || saving} className="ui-press h-11 w-full rounded-md bg-orange-700 px-4 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-60 dark:bg-orange-700 dark:text-white sm:w-auto">
                {saving ? copy.saving : copy.save}
              </button>
            </div>
          </SettingsPanel>
        </form>

        <SettingsPanel title={copy.linked} hint={copy.linkedHint}>
          <div className="grid gap-2">
            {[
              { label: copy.google, connected: isGoogleAccount, mark: "G" },
              { label: copy.local, connected: !isGoogleAccount, mark: "@" },
            ].map((account) => {
              const connectedAccountClassName = "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300";
              const disconnectedMarkClassName = "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500";
              const disconnectedBadgeClassName = "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";

              return (
              <div key={account.label} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-gray-200 px-3 py-3 dark:border-gray-800">
                <div className={`flex h-10 w-10 items-center justify-center rounded-md text-[13px] font-semibold ${account.connected ? connectedAccountClassName : disconnectedMarkClassName}`}>
                  {account.mark}
                </div>
                <p className="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white">{account.label}</p>
                <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${account.connected ? connectedAccountClassName : disconnectedBadgeClassName}`}>
                  {account.connected ? copy.connected : copy.notConnected}
                </span>
              </div>
              );
            })}
          </div>
        </SettingsPanel>

        <SettingsPanel title={copy.places} hint={copy.placesHint}>
          {memberships.length ? (
            <div className="grid gap-2">
              {memberships.map((membership) => {
                const name = membership.restaurant?.name ?? "-";
                const isActive = membership.status === "active";
                const joined = membership.joined_at
                  ? new Date(membership.joined_at).toLocaleDateString(language === "th" ? "th-TH" : "en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : null;
                const badgeClassName = isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";

                return (
                  <div
                    key={membership.ID}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-gray-200 px-3 py-3 dark:border-gray-800"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-50 text-[13px] font-semibold text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
                      {name.trim().charAt(0) || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{name}</p>
                      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {roleLabel(membership.role, language)}
                        {joined ? ` · ${copy.joined} ${joined}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${badgeClassName}`}>
                      {isActive ? copy.active : copy.suspended}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-gray-500 dark:text-gray-400">{copy.noPlaces}</p>
          )}
        </SettingsPanel>
      </div>
    </SettingsShell>
  );
}
