"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dropIndex, landingOffset, makeRoomOffset, moveItem, type RowBox } from "@/src/lib/reorder";

type Key = string | number;

type DragState = {
  key: Key;
  from: number;
  to: number;
  /** How far the pointer has moved since the press. */
  dy: number;
  /** Released, and gliding into its slot before the new order is saved. */
  dropping: boolean;
};

const SLIDE = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
const SETTLE_MS = 180;

/**
 * Drag a row by its handle to change the list's order. The row follows the
 * pointer continuously, the rows it passes slide aside, and on release it
 * glides into its slot; only then does `onCommit` get the new order, once, and
 * only when it changed. The DOM order never changes mid-drag - everything
 * moves by transform - so nothing jumps. Arrow keys on a focused handle move
 * the row by one, so the order can still be changed without a pointer.
 */
export function useDragReorder<T>(items: readonly T[], getKey: (item: T) => Key, onCommit: (next: T[]) => void, disabled = false) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const startY = useRef(0);
  const boxes = useRef<RowBox[]>([]);
  const rows = useRef(new Map<Key, HTMLElement>());
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const rowRef = useCallback(
    (key: Key) => (node: HTMLElement | null) => {
      if (node) rows.current.set(key, node);
      else rows.current.delete(key);
    },
    [],
  );

  const release = () => {
    const current = dragRef.current;
    if (!current || current.dropping) return;
    if (current.to === current.from) {
      update({ ...current, dy: 0, dropping: true });
      settleTimer.current = setTimeout(() => update(null), SETTLE_MS);
      return;
    }
    update({ ...current, dy: landingOffset(boxes.current, current.from, current.to), dropping: true });
    settleTimer.current = setTimeout(() => {
      update(null);
      onCommit(moveItem(items, current.from, current.to));
    }, SETTLE_MS);
  };

  const handleProps = (key: Key) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || dragRef.current || event.button !== 0) return;
      const from = items.findIndex((item) => getKey(item) === key);
      if (from < 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Every row is measured once, here, and the drag is worked out from
      // those numbers: the rows only ever move by transform, so their
      // measured places stay true for the whole drag.
      boxes.current = items.map((item) => {
        const rect = rows.current.get(getKey(item))?.getBoundingClientRect();
        return rect ? { top: rect.top, height: rect.height } : { top: 0, height: 0 };
      });
      startY.current = event.clientY;
      update({ key, from, to: from, dy: 0, dropping: false });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (!current || current.dropping || current.key !== key) return;
      const dy = event.clientY - startY.current;
      const own = boxes.current[current.from];
      const centers = boxes.current.filter((_, index) => index !== current.from).map((box) => box.top + box.height / 2);
      const to = dropIndex(centers, own.top + own.height / 2 + dy);
      update({ ...current, dy, to });
    },
    onPointerUp: release,
    onPointerCancel: release,
    onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || dragRef.current || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      event.stopPropagation();
      const from = items.findIndex((item) => getKey(item) === key);
      const to = from + (event.key === "ArrowUp" ? -1 : 1);
      if (from < 0 || to < 0 || to >= items.length) return;
      onCommit(moveItem(items, from, to));
    },
  });

  /** The transform each row wears during a drag; nothing when no row is dragged. */
  const rowStyle = (key: Key): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (key === drag.key) {
      return {
        transform: `translateY(${drag.dy}px)`,
        transition: drag.dropping ? SLIDE : "none",
        position: "relative",
        zIndex: 10,
      };
    }
    const index = items.findIndex((item) => getKey(item) === key);
    return { transform: `translateY(${makeRoomOffset(boxes.current, drag.from, drag.to, index)}px)`, transition: SLIDE };
  };

  return { draggingKey: drag?.key ?? null, rowRef, rowStyle, handleProps };
}
