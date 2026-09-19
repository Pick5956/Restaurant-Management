"use client";

import Image from "next/image";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import GoogleGlyph from "@/src/components/auth/GoogleGlyph";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { createSerialQueue } from "@/src/lib/serialQueue";
import type { User } from "@/src/types/auth";
import { updateProfile, uploadProfileImage } from "@/src/lib/auth";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { roleLabel } from "@/src/lib/roleLabels";
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsItem,
  SettingsValue,
} from "../_components/SettingsPrimitives";

function normalizePhone(value: string) {
  return value.replace(/[^\d+\-\s]/g, "").slice(0, 24);
}

function getDisplayName(user: ReturnType<typeof useAuth>["user"], language: Language) {
  if (!user) return language === "th" ? "ผู้ใช้งาน" : "User";
  if (user.nickname?.trim()) return user.nickname.trim();
  const parts = [user.first_name, user.last_name].map((part) => part?.trim()).filter((part) => part && part !== "-");
  return parts.length ? parts.join(" ") : user.email;
}

type ProfileForm = { first_name: string; last_name: string; nickname: string; phone: string };

const EMPTY_PROFILE: ProfileForm = { first_name: "", last_name: "", nickname: "", phone: "" };

function profileOf(user: User): ProfileForm {
  return {
    first_name: user.first_name ?? "",
    last_name: user.last_name === "-" ? "" : user.last_name ?? "",
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
  };
}

export default function AccountSettingsPage() {
  const { user, updateUser, memberships } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  // Saves run one after another so two quick changes are both kept.
  const [enqueueSave] = useState(() => createSerialQueue());
  const uploadOnceRef = useRef(createSingleFlight());
  const profileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  // What the server last confirmed; each save starts from it.
  const savedRef = useRef<ProfileForm | null>(null);
  const formStateRef = useRef(form);
  const syncedUserIdRef = useRef<number | null>(null);
  const [firstNameError, setFirstNameError] = useState("");
  const [uploading, setUploading] = useState(false);

  const copy = language === "th"
    ? {
        photo: "รูปโปรไฟล์",
        photoHint: "รูปที่แสดงคู่กับชื่อของคุณในแถบเมนูและรายชื่อพนักงาน ใช้ไฟล์ jpg, png หรือ webp ไม่เกิน 5MB",
        upload: "อัปโหลดรูป",
        replace: "เปลี่ยนรูป",
        email: "อีเมล",
        emailHint: "อีเมลที่ใช้เข้าสู่ระบบและรับลิงก์ตั้งรหัสผ่านใหม่",
        noEmail: "ไม่มีอีเมล",
        nickname: "ชื่อเล่น",
        nicknameHint: "ชื่อที่เพื่อนร่วมงานเห็นในออเดอร์ ครัว และรายชื่อพนักงาน ถ้าเว้นว่างจะใช้ชื่อจริงแทน",
        phone: "เบอร์โทร",
        phoneHint: "เบอร์ที่ร้านใช้ติดต่อคุณ",
        firstName: "ชื่อ",
        firstNameHint: "ชื่อจริงของคุณ",
        lastName: "นามสกุล",
        lastNameHint: "นามสกุลของคุณ",
        save: "บันทึกบัญชี",
        required: "กรอกชื่อ",
        saveError: "บันทึกข้อมูลบัญชีไม่สำเร็จ",
        uploadError: "อัปโหลดรูปไม่สำเร็จ",
        uploadHint: "ใช้ไฟล์ jpg, png หรือ webp ไม่เกิน 5MB",
        google: "บัญชี Google",
        googleHint: "เข้าสู่ระบบด้วยบัญชี Google",
        local: "อีเมลและรหัสผ่าน",
        localHint: "เข้าสู่ระบบด้วยอีเมลและรหัสผ่านของ Dishy",
        connected: "เชื่อมแล้ว",
        notConnected: "ยังไม่เชื่อม",
        places: "ร้านที่คุณอยู่",
        joined: "เข้าร่วมเมื่อ",
        active: "ใช้งานอยู่",
        suspended: "ถูกระงับ",
        noPlaces: "ยังไม่ได้เป็นสมาชิกร้านไหน",
        unnamed: "ไม่ระบุชื่อร้าน",
      }
    : {
        photo: "Profile photo",
        photoHint: "Shown beside your name in the menu bar and the staff list. Use a jpg, png or webp file up to 5MB.",
        upload: "Upload photo",
        replace: "Change photo",
        email: "Email",
        emailHint: "The email you sign in with and where password-reset links are sent.",
        noEmail: "No email",
        nickname: "Nickname",
        nicknameHint: "The name your coworkers see on orders, in the kitchen and in the staff list. Leave it empty to use your first name.",
        phone: "Phone",
        phoneHint: "The number the restaurant uses to reach you.",
        firstName: "First name",
        firstNameHint: "Your first name.",
        lastName: "Last name",
        lastNameHint: "Your last name.",
        save: "Save account",
        required: "Enter your first name",
        saveError: "Could not save account details.",
        uploadError: "Could not upload the photo.",
        uploadHint: "Use a jpg, png or webp file up to 5MB.",
        google: "Google account",
        googleHint: "Sign in with your Google account.",
        local: "Email and password",
        localHint: "Sign in with your Dishy email and password.",
        connected: "Connected",
        notConnected: "Not connected",
        places: "Your restaurants",
        joined: "Joined",
        active: "Active",
        suspended: "Suspended",
        noPlaces: "Not a member of any restaurant yet.",
        unnamed: "Unnamed restaurant",
      };

  const displayName = getDisplayName(user, language);
  const isGoogleAccount = user?.auth_provider === "google";

  // Fill the fields when the signed-in account is known. Only when the account
  // itself changes: a save updates the user too, and refilling then would wipe
  // whatever is being typed into another field at that moment.
  useEffect(() => {
    if (!user || syncedUserIdRef.current === user.ID) return;
    const syncTimer = window.setTimeout(() => {
      syncedUserIdRef.current = user.ID;
      const profile = profileOf(user);
      savedRef.current = profile;
      setForm(profile);
      setFirstNameError("");
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [user]);

  useEffect(() => {
    formStateRef.current = form;
  });

  const setField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "first_name") setFirstNameError("");
  };

  /**
   * Saves one field as soon as it is finished (focus leaves it, or Enter) -
   * there is no save button. The body is the last saved profile with only this
   * field changed, so a half-typed value elsewhere is never sent along.
   */
  const commitProfile = (key: keyof ProfileForm) => {
    void enqueueSave(async () => {
      const saved = savedRef.current;
      if (!saved) return;
      const value = formStateRef.current[key].trim();
      if (value === saved[key]) return;
      if (key === "first_name" && !value) {
        setFirstNameError(copy.required);
        return;
      }
      try {
        const res = await updateProfile({ ...saved, [key]: value });
        updateUser(res.data);
        const next = profileOf(res.data);
        savedRef.current = next;
        setForm((current) => ({ ...current, [key]: next[key] }));
      } catch {
        // Back to what is actually saved, so the field never shows a value the
        // server does not have.
        setForm((current) => ({ ...current, [key]: saved[key] }));
        showToast({ title: copy.saveError, tone: "error" });
      }
    });
  };

  const uploadPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;

    await uploadOnceRef.current(async () => {
      setUploading(true);
      try {
        const res = await uploadProfileImage(file);
        updateUser(res.data);
      } catch {
        showToast({ title: copy.uploadError, message: copy.uploadHint, tone: "error" });
      } finally {
        setUploading(false);
      }
    });
  };

  const photoAction = user?.profile_image ? copy.replace : copy.upload;

  return (
    <>
      <div>
        <SettingsItem title={copy.photo} description={copy.photoHint}>
          <div className="flex items-center gap-4">
            <UserAvatar src={user?.profile_image} name={displayName} size={48} className="h-12 w-12 text-base" />
            <input ref={profileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadPhoto} tabIndex={-1} />
            <SettingsButton
              loading={uploading}
              disabled={!user}
              aria-label={`${photoAction} ${copy.photo}`}
              onClick={() => profileInputRef.current?.click()}
              className="flex-1 md:w-[220px] md:flex-none"
            >
              {photoAction}
            </SettingsButton>
          </div>
        </SettingsItem>
        <SettingsValue label={copy.email} description={copy.emailHint} value={user?.email || copy.noEmail} />
        <SettingsField label={copy.nickname} description={copy.nicknameHint} value={form.nickname} onChange={(value) => setField("nickname", value)} onCommit={() => commitProfile("nickname")} autoComplete="nickname" />
        <SettingsField label={copy.phone} description={copy.phoneHint} value={form.phone} onChange={(value) => setField("phone", normalizePhone(value))} onCommit={() => commitProfile("phone")} inputMode="tel" autoComplete="tel" />
        <SettingsField label={copy.firstName} description={copy.firstNameHint} value={form.first_name} onChange={(value) => setField("first_name", value)} onCommit={() => commitProfile("first_name")} error={firstNameError} autoComplete="given-name" />
        <SettingsField label={copy.lastName} description={copy.lastNameHint} value={form.last_name} onChange={(value) => setField("last_name", value)} onCommit={() => commitProfile("last_name")} autoComplete="family-name" />
      </div>

      {[
        { key: "google", label: copy.google, hint: copy.googleHint, connected: isGoogleAccount, icon: <GoogleGlyph className="h-[18px] w-[18px]" /> },
        { key: "local", label: copy.local, hint: copy.localHint, connected: !isGoogleAccount, icon: <Mail aria-hidden="true" className="h-[18px] w-[18px] text-gray-700 dark:text-gray-200" /> },
      ].map((account) => (
        <SettingsItem key={account.key} title={account.label} description={account.hint}>
          <div className="flex items-center gap-3 md:justify-end">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-(--settings-field)">{account.icon}</span>
            <SettingsBadge tone={account.connected ? "success" : "neutral"}>
              {account.connected ? copy.connected : copy.notConnected}
            </SettingsBadge>
          </div>
        </SettingsItem>
      ))}

      {memberships.length ? (
        memberships.map((membership) => {
          const name = membership.restaurant?.name?.trim() || copy.unnamed;
          const logo = membership.restaurant?.logo?.trim();
          const isActive = membership.status === "active";
          const joined = membership.joined_at
            ? new Date(membership.joined_at).toLocaleDateString(language === "th" ? "th-TH" : "en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : null;
          const detail = [roleLabel(membership.role, language), joined ? `${copy.joined} ${joined}` : null]
            .filter(Boolean)
            .join(", ");

          return (
            <SettingsItem key={membership.ID} title={name} description={detail}>
              <div className="flex items-center gap-3 md:justify-end">
                {logo ? (
                  <Image src={logo} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-(--settings-field) text-[14px] font-semibold text-gray-700 dark:text-gray-200">
                    {name.charAt(0)}
                  </span>
                )}
                <SettingsBadge tone={isActive ? "success" : "neutral"}>{isActive ? copy.active : copy.suspended}</SettingsBadge>
              </div>
            </SettingsItem>
          );
        })
      ) : (
        <SettingsItem title={copy.places} description={copy.noPlaces}>
          {null}
        </SettingsItem>
      )}
    </>
  );
}
