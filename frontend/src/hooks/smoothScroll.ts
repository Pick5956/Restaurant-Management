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
  // notch coasts about 100px — what one notch moves without this — and takes
  // about a second to settle. It was 165px, which covered ground too fast.
  const PUSH_PER_PX = 0.0034;
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
    // A frame's timestamp is when the frame began, which can be a little
    // before the wheel event that started the glide — a negative step that
    // pushed the list backwards into the top edge and stopped it dead on the
    // first frame. Never negative; a dropped frame is not a leap either.
    const dt = Math.min(48, Math.max(0, now - last));
    last = Math.max(last, now);
    position += velocity * dt;
    velocity *= Math.exp(-dt / FRICTION_MS);
    const max = maxTop();
    // Only an edge it is moving toward stops it: a glide that starts at the
    // very top on its way down is not "at the top".
    if ((position <= 0 && velocity < 0) || (position >= max && velocity > 0)) {
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

  // A plain scrolling box inside this one (no smoothScroll of its own) that can
  // still move the way the wheel turns. The wheel is its to take: this list
  // used to cancel the event first, so on the overview the day's order list
  // inside the sales card never scrolled — the card did instead (19 ก.ย. 2569).
  const innerCanTake = (target: EventTarget | null, delta: number) => {
    for (let el = target instanceof Element ? target : null; el && el !== node; el = el.parentElement) {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
      if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
      if (delta < 0 ? el.scrollTop > 1 : el.scrollTop < el.scrollHeight - el.clientHeight - 1) return true;
    }
    return false;
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !event.deltaY) return; // pinch-zoom, sideways
    if (event.defaultPrevented) return;
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? node.clientHeight : 1;
    const delta = event.deltaY * unit;
    if (frame === null && innerCanTake(event.target, delta)) return;
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
