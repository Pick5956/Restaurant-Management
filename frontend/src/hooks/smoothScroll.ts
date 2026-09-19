/**
 * Smooth mouse-wheel scrolling for a vertical list, as a React ref callback:
 *
 *   <div ref={smoothScroll} className="overflow-y-auto">…</div>
 *
 * Each wheel notch moves a target, and the list eases toward it and slows to a
 * stop — the glide the time wheel has — instead of jumping 100px at a time.
 * At the top or bottom the wheel is left alone, so the page itself scrolls on
 * and a list never traps the wheel. Touch and trackpad momentum are the
 * browser's own and untouched; there is no mouse drag here, only the wheel.
 *
 * Returns a cleanup, which React 19 calls when the element goes away.
 */
export function smoothScroll(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return;

  // Fraction of the remaining distance covered each frame: the ease-out.
  const EASE = 0.2;

  let target: number | null = null;
  let frame: number | null = null;

  const maxTop = () => Math.max(0, node.scrollHeight - node.clientHeight);
  const clamp = (value: number) => Math.min(Math.max(value, 0), maxTop());

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    target = null;
  };

  const step = () => {
    if (target === null) {
      frame = null;
      return;
    }
    const current = node.scrollTop;
    const move = (target - current) * EASE;
    // The browser rounds scrollTop to whole device pixels, so the last few
    // sub-pixel steps would never land — the list stopped 2px short of its
    // end. Under a pixel, finish in one go.
    if (Math.abs(move) < 1) {
      node.scrollTop = target;
      stop();
      return;
    }
    node.scrollTop = current + move;
    // Pinned against an edge the browser will not pass: stop rather than spin.
    if (node.scrollTop === current) {
      node.scrollTop = target;
      stop();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !event.deltaY) return; // pinch-zoom, sideways
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? node.clientHeight : 1;
    const base = target ?? node.scrollTop;
    const next = clamp(base + event.deltaY * unit);
    // Nothing left to scroll this way: let the page have the wheel.
    if (Math.abs(next - base) < 0.5) return;
    event.preventDefault();
    target = next;
    if (frame === null) frame = requestAnimationFrame(step);
  };

  node.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    stop();
    node.removeEventListener("wheel", onWheel);
  };
}
