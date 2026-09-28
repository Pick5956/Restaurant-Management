import { useId } from "react";

type Props = {
  className?: string;
};

/**
 * lucide's Pencil, filled solid. lucide ships outline only, so this is its
 * path with a fill; the band at the eraser end is cut out with a mask rather
 * than painted in the background colour, so it stays see-through on any
 * surface and in both themes.
 */
export default function SolidPencilIcon({ className }: Props) {
  // useId's colons/guillemets are not safe inside url(#...).
  const maskId = `pencil-band-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <path d="m14.6 5.4 4 4" stroke="black" strokeWidth="1.6" strokeLinecap="round" />
      </mask>
      <path
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
