"use client";

import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { SettingsSelect, SettingsSwitch } from "../_components/SettingsPrimitives";

export default function DisplaySettingsPage() {
  const { language, setLanguage } = useLanguage();
  const { theme, mounted, toggle, showAIAssistant, setShowAIAssistant } = useTheme();
  // Before the provider has read localStorage every render says "light"; the
  // account menu reads it the same way rather than flashing the wrong value.
  const isDark = mounted && theme === "dark";

  const copy = language === "th"
    ? {
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

  return (
    <>
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
    </>
  );
}
