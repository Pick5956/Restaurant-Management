"use client";

import { useLanguage } from "@/src/providers/LanguageProvider";

// `tone="dark"` is for a page that is always dark whatever the theme, like the
// landing page: a see-through pill as tall and round as the orange sign-in
// button beside it. The plain white box stood 10px taller than that button and
// was the brightest thing in the black header (28 ก.ย. 2569).
const TONES = {
  auto: {
    box: "rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-800 dark:bg-gray-950",
    button: "h-8 rounded-md px-2.5 text-[11px]",
    active: "bg-gray-900 text-white dark:bg-white dark:text-gray-900",
    idle: "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
  },
  dark: {
    box: "h-7 rounded-full border border-white/15 bg-white/5 p-0.5",
    button: "h-full rounded-full px-2.5 text-[12px]",
    active: "bg-white/20 text-white",
    idle: "text-white/50 hover:text-white",
  },
} as const;

export default function LanguageToggle({
  className = "",
  tone = "auto",
}: {
  className?: string;
  tone?: keyof typeof TONES;
}) {
  const { language, setLanguage } = useLanguage();
  const look = TONES[tone];

  return (
    <div className={`inline-flex items-center ${look.box} ${className}`}>
      {([
        { value: "th", label: "TH" },
        { value: "en", label: "EN" },
      ] as const).map((option) => {
        const active = language === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLanguage(option.value)}
            aria-label={option.value === "th" ? "แสดงภาษาไทย" : "Display in English"}
            aria-pressed={active}
            lang={option.value}
            className={`${look.button} font-semibold transition-colors ${active ? look.active : look.idle}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
