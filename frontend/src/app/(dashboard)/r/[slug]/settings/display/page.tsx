"use client";

import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { Check, Globe } from "lucide-react";
import { SettingsSelect, SettingsSwitch, SettingsGroup } from "../_components/SettingsPrimitives";
import { MobileLabel, MobilePills, MobileSection, MobileSwitchTile, useSettingsPhone } from "../_components/SettingsMobileKit";

export default function DisplaySettingsPage() {
  const { language, setLanguage } = useLanguage();
  const { theme, mounted, toggle, showAIAssistant, setShowAIAssistant } = useTheme();
  // Before the provider has read localStorage every render says "light"; the
  // account menu reads it the same way rather than flashing the wrong value.
  const isDark = mounted && theme === "dark";
  const phone = useSettingsPhone();

  const copy = language === "th"
    ? {
        groupTitle: "ภาษาและการแสดงผล",
        language: "ภาษา",
        languageHint: "ภาษาที่ใช้แสดงเมนู ปุ่ม และข้อความทั้งหมดในระบบ",
        thai: "ไทย",
        english: "English",
        theme: "ธีม",
        themeHint: "ธีมของเว็บ มีผลเฉพาะเครื่องนี้",
        light: "สว่าง",
        dark: "มืด",
        aiAssistant: "ปุ่มผู้ช่วย AI",
        aiAssistantHint: "แสดงปุ่มลอยสำหรับเรียกผู้ช่วย AI มุมล่างของหน้าจอ มีผลเฉพาะเครื่องนี้",
      }
    : {
        groupTitle: "Language and display",
        language: "Language",
        languageHint: "The language used for menus, buttons and every message in the system.",
        thai: "Thai",
        english: "English",
        theme: "Appearance",
        themeHint: "The theme of the site. Applies to this device only.",
        light: "Light",
        dark: "Dark",
        aiAssistant: "AI assistant button",
        aiAssistantHint: "Shows the floating button that opens the AI assistant at the bottom of the screen. Applies to this device only.",
      };

  if (phone) {
    // The theme is picked from two small screens drawn in its own colours.
    const themeCard = (dark: boolean) => {
      const on = isDark === dark;
      return (
        <button
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => {
            if (!on) toggle();
          }}
          className={`ui-press rounded-2xl p-2 text-center ${on ? "border-2 border-(--inv-action)" : "border border-(--inv-hairline)"}`}
        >
          <span className={`block h-[62px] rounded-[10px] p-2 ${dark ? "bg-[#0f0f0f]" : "bg-[#f1f5f9]"}`}>
            <span className={`block h-2 w-3/5 rounded ${dark ? "bg-[#404040]" : "bg-[#cbd5e1]"}`} />
            <span className={`mt-1.5 block h-[22px] rounded-md ${dark ? "bg-[#212121]" : "bg-white"}`} />
          </span>
          <span className={`mt-1.5 inline-flex items-center gap-1 text-[13px] ${on ? "font-semibold text-(--inv-action)" : "text-(--inv-muted)"}`}>
            {dark ? copy.dark : copy.light}
            {on ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
          </span>
        </button>
      );
    };
    return (
      <MobileSection
        id="display"
        title={language === "th" ? "การแสดงผล" : "Display"}
        summary={language === "th" ? "ธีมกับปุ่ม AI มีผลเฉพาะเครื่องนี้" : "Theme and AI button apply to this device only"}
        icon={Globe}
        tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
        keywords={[copy.language, copy.theme, copy.aiAssistant, copy.light, copy.dark].join(" ")}
      >
        <MobileLabel>{copy.theme}</MobileLabel>
        <div role="radiogroup" aria-label={copy.theme} className="mb-3.5 grid grid-cols-2 gap-2.5">
          {themeCard(false)}
          {themeCard(true)}
        </div>
        <MobileLabel>{copy.language}</MobileLabel>
        <div className="mb-3.5">
          <MobilePills
            label={copy.language}
            value={language}
            onChange={(next) => setLanguage(next as Language)}
            options={[{ value: "th", label: copy.thai }, { value: "en", label: copy.english }]}
          />
        </div>
        <MobileSwitchTile title={copy.aiAssistant} hint={copy.aiAssistantHint} checked={showAIAssistant} onChange={setShowAIAssistant} />
      </MobileSection>
    );
  }

  return (
    <SettingsGroup id="display" title={copy.groupTitle}>
      <SettingsSelect
        label={copy.language}
        description={copy.languageHint}
        value={language}
        onChange={(nextValue) => setLanguage(nextValue as Language)}
        options={[
          { value: "th", label: copy.thai },
          { value: "en", label: copy.english },
        ]}
      />
      <SettingsSelect
        label={copy.theme}
        description={copy.themeHint}
        value={isDark ? "dark" : "light"}
        onChange={(nextValue) => {
          if ((nextValue === "dark") !== isDark) toggle();
        }}
        options={[
          { value: "light", label: copy.light },
          { value: "dark", label: copy.dark },
        ]}
      />
      <SettingsSwitch label={copy.aiAssistant} description={copy.aiAssistantHint} checked={showAIAssistant} onChange={setShowAIAssistant} />
    </SettingsGroup>
  );
}
