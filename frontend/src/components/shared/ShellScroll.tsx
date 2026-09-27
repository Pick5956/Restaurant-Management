"use client";

import { smoothScroll } from "@/src/hooks/smoothScroll";

/**
 * The shell's page scroller. Every dashboard page glides on the mouse wheel
 * and coasts on after it, the way the inventory page did on its own. It used
 * to be wired up page by page, so the pages that never did it still jumped a
 * fixed step per notch (26 ก.ย. 2569).
 */
export default function ShellScroll({ children }: { children: React.ReactNode }) {
  return (
    <div ref={smoothScroll} data-shell-scroll="">
      {children}
    </div>
  );
}
