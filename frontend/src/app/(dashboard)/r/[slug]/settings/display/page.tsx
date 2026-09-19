"use client";

import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { SettingsSelect, SettingsSwitch } from "../_components/SettingsPrimitives";

export default function DisplaySettingsPage() {
  const { language, setLanguage } = useLanguage();
  const { showAIAssistant, setShowAIAssistant } = useTheme();

  const copy = language === "th"
    ? {
        language: "ภาษา",
        languageHint: "ภาษาที่ใช้แสดงเมนู ปุ่ม และข้อความทั้งหมดในระบบ",
        thai: "ไทย",
        english: "English",
        aiAssistant: "ปุ่มผู้ช่วย AI",
        aiAssistantHint: "แสดงปุ่มลอยสำหรับเรียกผู้ช่วย AI มุมล่างของหน้าจอ มีผลเฉพาะเครื่องนี้",
      }
    : {
        language: "Language",
        languageHint: "The language used for menus, buttons and every message in the system.",
        thai: "Thai",
        english: "English",
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
      <SettingsSwitch label={copy.aiAssistant} description={copy.aiAssistantHint} checked={showAIAssistant} onChange={setShowAIAssistant} />
    </>
  );
}
