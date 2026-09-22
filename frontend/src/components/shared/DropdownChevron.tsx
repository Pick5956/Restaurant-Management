/**
 * The arrow on every dropdown on the web: a dark 15px chevron with a heavy
 * stroke, near-black in light mode and near-white in dark. The owner picked it
 * from a reference site's language picker (2026-09-21) - "ลูกศรเข้มๆ" - over the
 * pale grey 16px one the selects used to draw. It turns over while its list is
 * open. Only the arrow changed; each field keeps its own face.
 */
export default function DropdownChevron({ open = false, className = "" }: { open?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[15px] w-[15px] shrink-0 text-gray-900 transition-transform dark:text-gray-100 ${open ? "rotate-180" : ""} ${className}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
