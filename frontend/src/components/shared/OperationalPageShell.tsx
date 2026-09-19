"use client";

type OperationalStat = {
  label: string;
  value: React.ReactNode;
  helper?: string;
  tone?: "neutral" | "good" | "warning" | "danger" | "info";
};

const statToneClass: Record<NonNullable<OperationalStat["tone"]>, string> = {
  neutral: "text-gray-900 dark:text-white",
  good: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
  info: "text-sky-700 dark:text-sky-300",
};

export default function OperationalPageShell({
  eyebrow,
  title,
  subtitle,
  actions,
  showHeader = true,
  hideHeaderText = false,
  edgeToEdge = false,
  stats,
  lastUpdated,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showHeader?: boolean;
  // Hide the eyebrow/title/subtitle text (the sidebar already names the page)
  // while keeping any actions. The title stays as a visually-hidden heading so
  // the document outline and screen readers are unaffected.
  hideHeaderText?: boolean;
  edgeToEdge?: boolean;
  stats?: OperationalStat[];
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`w-full max-w-full overflow-x-hidden bg-slate-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 ${
        edgeToEdge
          ? "flex h-dvh min-h-0 overflow-y-hidden lg:h-[calc(100dvh-var(--shell-pad)*2)]"
          // Phones have had no top bar since 19 ก.ย. 2569, so the full height.
          // On lg the shell sheet already inset itself by --shell-pad.
          : "min-h-dvh px-4 py-4 sm:px-6 lg:min-h-[calc(100dvh-3.5rem)] lg:px-8 lg:py-6"
      }`}
    >
      <div className={edgeToEdge ? "flex min-h-0 w-full flex-1 flex-col" : "w-full space-y-5"}>
        {showHeader ? (
          hideHeaderText ? (
            <>
              <h1 className="sr-only">{title}</h1>
              {actions || lastUpdated ? (
                <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="min-w-0">
                    {lastUpdated ? <p className="text-[11px] text-gray-500 dark:text-gray-500">{lastUpdated}</p> : null}
                  </div>
                  {actions ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{actions}</div> : null}
                </header>
              ) : null}
            </>
          ) : (
            <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400">{eyebrow}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{title}</h1>
                {subtitle ? <p className="mt-1 max-w-3xl text-[13px] leading-5 text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
                {lastUpdated ? <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">{lastUpdated}</p> : null}
              </div>
              {actions ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{actions}</div> : null}
            </header>
          )
        ) : null}

        {stats?.length ? (
          <div className="grid grid-cols-3 gap-1 rounded-md border border-gray-200 bg-white p-1.5 dark:border-gray-800 dark:bg-gray-950 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 dark:sm:bg-transparent">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0 rounded-[4px] px-2 py-2 text-center sm:rounded-md sm:border sm:border-gray-200 sm:bg-white sm:px-3 sm:py-2.5 sm:text-left sm:dark:border-gray-800 sm:dark:bg-gray-950">
                <p className="truncate text-[10px] font-medium text-gray-500 dark:text-gray-400 sm:text-[11px]">{stat.label}</p>
                <p className={`mt-0.5 text-[20px] font-semibold leading-none tabular-nums sm:mt-1 sm:text-[22px] ${statToneClass[stat.tone ?? "neutral"]}`}>{stat.value}</p>
                {stat.helper ? <p className="mt-1 truncate text-[10px] text-gray-500 dark:text-gray-400 sm:text-[12px]">{stat.helper}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}
