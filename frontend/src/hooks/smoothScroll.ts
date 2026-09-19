/**
 * Mouse-wheel scrolling with momentum, as a React ref callback:
 *
 *   <div ref={smoothScroll} className="overflow-y-auto">…</div>
 *
 * Each wheel notch gives the list a push instead of moving it a fixed step.
 * The list runs on that speed and friction bleeds it away, so it keeps moving
 * for a moment after the wheel stops and comes to rest on its own — the coast
 * the time wheel has. Notches in quick succession add up, so a fast spin goes
 * further; turning the wheel the other way cancels the coast at once.
 *
 * At the top or bottom the wheel is left alone, so the page itself scrolls on
 * and a list never traps the wheel. A wheel event a nested list has already
 * taken is ignored, so a list and the page never scroll on the same notch.
 * Touch and trackpad momentum are the browser's own and untouched.
 *
 * Returns a cleanup, which React 19 calls when the element goes away.
 */
export function smoothScroll(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return;

  // Speed a 100px notch adds, in px per ms. With FRICTION_MS below a single
  // notch coasts about 165px and takes about a second to settle.
  const PUSH_PER_PX = 0.0055;
  // Time constant of the slow-down: speed falls to ~37% every this many ms.
  const FRICTION_MS = 300;
  // Below this speed (px/ms) the list has stopped.
  const REST = 0.02;
  // A hard spin can build speed, but not without end.
  const MAX_SPEED = 6;

  let velocity = 0;
  let position = node.scrollTop;
  let frame: number | null = null;
  let last = 0;

  const maxTop = () => Math.max(0, node.scrollHeight - node.clientHeight);

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    velocity = 0;
  };

  const step = (now: number) => {
    const dt = Math.min(48, now - last); // a dropped frame is not a leap
    last = now;
    position += velocity * dt;
    velocity *= Math.exp(-dt / FRICTION_MS);
    const max = maxTop();
    if (position <= 0 || position >= max) {
      position = Math.min(Math.max(position, 0), max);
      node.scrollTop = position;
      stop();
      return;
    }
    node.scrollTop = position;
    if (Math.abs(velocity) < REST) {
      stop();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !event.deltaY) return; // pinch-zoom, sideways
    if (event.defaultPrevented) return;
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? node.clientHeight : 1;
    const delta = event.deltaY * unit;
    const max = maxTop();
    // Resting against the edge it is being pushed into: the page scrolls.
    // 1px slack: scrollTop is rounded and can sit a pixel short of the end.
    if (frame === null && ((delta < 0 && node.scrollTop <= 1) || (delta > 0 && node.scrollTop >= max - 1))) return;
    event.preventDefault();
    if (frame === null) position = node.scrollTop; // someone else may have moved it
    // Reversing kills the coast rather than fighting it.
    if (Math.sign(delta) !== Math.sign(velocity)) velocity = 0;
    velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity + delta * PUSH_PER_PX));
    if (frame === null) {
      last = performance.now();
      frame = requestAnimationFrame(step);
    }
  };

  node.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    stop();
    node.removeEventListener("wheel", onWheel);
  };
}
