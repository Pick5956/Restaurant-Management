"use client";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-800/80",
        className
      )}
    />
  );
}

export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "h-3",
            index === lines - 1 && lines > 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  );
}

export function RestaurantCardSkeleton() {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-left dark:border-gray-800 dark:bg-gray-950 min-h-[260px]">
      {/* Cover Image banner skeleton */}
      <div className="relative h-28 w-full bg-gray-100 dark:bg-gray-900 animate-pulse" />

      {/* Logo overlapping the cover */}
      <div className="absolute left-4 top-22 z-10 flex h-12 w-12 items-center justify-center rounded-md border-2 border-white bg-white shadow-sm dark:border-gray-950 dark:bg-gray-950">
        <Skeleton className="h-full w-full rounded-md" />
      </div>

      {/* Content area */}
      <div className="w-full pt-8 px-4 pb-4 flex flex-col justify-between flex-1">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4.5 w-14" />
          </div>
          <Skeleton className="mt-2 h-3.5 w-36" />

          <div className="mt-3.5 space-y-2 border-t border-gray-100 dark:border-gray-800/60 pt-3">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-22" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

export function WorkspacePageSkeleton() {
  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9" />
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full max-w-2xl">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-3 h-8 w-72 max-w-full" />
            <SkeletonText lines={2} className="mt-3 max-w-xl" />
          </div>
          <Skeleton className="h-10 w-64 max-w-full" />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-64 max-w-full" />
            </div>
            <div className="space-y-3 p-4">
              <RestaurantCardSkeleton />
              <RestaurantCardSkeleton />
              <RestaurantCardSkeleton />
            </div>
          </section>
          <aside className="space-y-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </aside>
        </div>
      </main>
    </div>
  );
}

/**
 * Fills the content slot while a dashboard route loads. Deliberately has no
 * sidebar and no page chrome: the layout around it is already on screen and
 * stays put, so only the part that is actually changing should flicker.
 */
export function DashboardContentSkeleton() {
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <Skeleton className="h-3 w-36" />
      <Skeleton className="mt-3 h-7 w-56 max-w-full" />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-56" />
        </div>
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="min-h-dvh bg-white dark:bg-gray-950">
      <div className="hidden lg:block fixed inset-y-0 left-0 w-[220px] border-r border-gray-200 bg-slate-50 p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9" />
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="mt-8 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </div>

      <div className="lg:ml-60">
        <main className="px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-3 h-8 w-64 max-w-full" />
            </div>
            <Skeleton className="h-9 w-36" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Skeleton className="h-80 lg:col-span-8" />
            <Skeleton className="h-80 lg:col-span-4" />
            <Skeleton className="h-72 lg:col-span-5" />
            <Skeleton className="h-72 lg:col-span-7" />
          </div>
        </main>
      </div>
    </div>
  );
}

export function LandingPageSkeleton() {
  return (
    <div className="min-h-dvh bg-white dark:bg-gray-950">
      <header className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
        <section>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-5 h-12 w-full max-w-xl" />
          <Skeleton className="mt-3 h-12 w-4/5 max-w-lg" />
          <SkeletonText lines={3} className="mt-6 max-w-xl" />
          <div className="mt-6 flex gap-3">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-28" />
          </div>
        </section>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-52 sm:col-span-2" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </section>
      </main>
    </div>
  );
}
