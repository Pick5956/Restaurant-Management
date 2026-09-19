"use client";

import type { ReactNode } from "react";

// Small styled tooltip to replace the browser's default `title` bubble, which
// arrives late and can't be themed. Wrap an icon button; keep its aria-label so
// screen readers still get the name.

export default function HoverTip({
  label,
  children,
  placement = "top",
  className = "",
}: {
  label: string;
  children: ReactNode;
  placement?: "top" | "bottom";
  className?: string;
}) {
  const onTop = placement === "top";

  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium leading-none text-white opacity-0 shadow-lg transition-[opacity,translate] duration-150 ease-out group-hover/tip:translate-y-0 group-hover/tip:opacity-100 dark:bg-white dark:text-gray-900 ${
          onTop ? "bottom-full mb-2 translate-y-1" : "top-full mt-2 -translate-y-1"
        }`}
      >
        {label}
        <span
          className={`absolute left-1/2 -ml-1 border-4 border-transparent ${
            onTop
              ? "top-full border-t-gray-900 dark:border-t-white"
              : "bottom-full border-b-gray-900 dark:border-b-white"
          }`}
        />
      </span>
    </span>
  );
}
