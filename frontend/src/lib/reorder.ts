/** The list with the entry at `from` taken out and put back at `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return [...list];
  const rest = list.filter((_, index) => index !== from);
  return [...rest.slice(0, target), list[from], ...rest.slice(target)];
}

/**
 * Where a dragged row lands: after every other row whose middle is above the
 * dragged row's middle. `centers` are the other rows' vertical middles, in list order.
 */
export function dropIndex(centers: readonly number[], draggedCenter: number): number {
  return centers.filter((center) => center < draggedCenter).length;
}

/** A row's place in the list, measured when the drag began. */
export type RowBox = { top: number; height: number };

function rowStep(boxes: readonly RowBox[], from: number): number {
  const gap = boxes.length > 1 ? boxes[1].top - (boxes[0].top + boxes[0].height) : 0;
  return boxes[from].height + gap;
}

/**
 * How far a row that is not being dragged slides to make room: the rows
 * between the dragged row's old and new place move one dragged row over.
 */
export function makeRoomOffset(boxes: readonly RowBox[], from: number, to: number, index: number): number {
  if (to > from && index > from && index <= to) return -rowStep(boxes, from);
  if (to < from && index >= to && index < from) return rowStep(boxes, from);
  return 0;
}

/** How far the dragged row travels from its old place to the slot it lands in. */
export function landingOffset(boxes: readonly RowBox[], from: number, to: number): number {
  if (to > from) return boxes[to].top + boxes[to].height - (boxes[from].top + boxes[from].height);
  if (to < from) return boxes[to].top - boxes[from].top;
  return 0;
}
