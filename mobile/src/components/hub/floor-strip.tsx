import { useState } from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import {
  FLOOR_BAR_GAP,
  FLOOR_BAR_HEIGHT,
  FLOOR_BAR_MIN_PART,
  FLOOR_CELL_GAP,
  FLOOR_MIN_CELL,
  floorBarWidths,
  floorCellWidth,
  floorStripShape,
} from '@/src/lib/hub-stage-layout';
import type { HubTableCell } from '@/src/lib/hub-types';
import { tableTileTones } from '@/src/lib/table-tile-tone';
import { palette } from '@/src/theme';

// The floor as a strip of cells, one per table in the tables screen's order,
// in the tables screen's own fills: celadon free, honey occupied, porcelain
// reserved. A table whose bill is waiting keeps its fill and gains a 2 pt blue
// edge inside it - the cashier's cue. The words beside the strip carry the
// numbers, so the strip itself is hidden from screen readers. The shape and
// every width are decided in hub-stage-layout.ts.

const BAR_RADIUS = FLOOR_BAR_HEIGHT / 2;
const BILL_EDGE = 2;

export type FloorStripProps = Omit<ViewProps, 'children'> & {
  cells: readonly HubTableCell[];
  /** Height of a cell (of each row when the strip wraps). Default 14. The bar form is always 12. */
  height?: number;
  /** Default 4. */
  cellRadius?: number;
  /**
   * The widest a cell grows, so a floor of a few tables reads as a few squares
   * from the row's start. Default: no cap, every cell shares the full width.
   */
  maxCellWidth?: number;
  /** The strip's width before it has measured itself, so the first frame already has its final shape. */
  initialWidth?: number;
  style?: StyleProp<ViewStyle>;
};

/** Renders nothing for a floor with no tables; the figure beside it says so. */
export function FloorStrip({
  cells,
  height = 14,
  cellRadius = 4,
  maxCellWidth = Number.POSITIVE_INFINITY,
  initialWidth = 0,
  style,
  onLayout,
  ...rest
}: FloorStripProps) {
  const [measured, setMeasured] = useState(0);
  if (!cells.length) return null;
  const width = measured > 0 ? measured : initialWidth;
  const shape = floorStripShape(cells.length, width);
  const half = Math.ceil(cells.length / 2);
  const row = { height, radius: cellRadius, width, maxCell: maxCellWidth };

  return (
    <View
      {...rest}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        setMeasured((current) => (Math.abs(current - next) < 0.5 ? current : next));
        onLayout?.(event);
      }}
      style={[{ gap: FLOOR_CELL_GAP }, style]}
    >
      {shape === 'bar' ? (
        <FloorBar cells={cells} width={width} />
      ) : shape === 'rows' ? (
        <>
          <CellRow {...row} cells={cells.slice(0, half)} columns={half} />
          <CellRow {...row} cells={cells.slice(half)} columns={half} />
        </>
      ) : (
        <CellRow {...row} cells={cells} columns={cells.length} />
      )}
    </View>
  );
}

function cellStyle(cell: HubTableCell): ViewStyle {
  return {
    backgroundColor: tableTileTones[cell.tone].fill,
    borderWidth: cell.waitingBill ? BILL_EDGE : 0,
    borderColor: palette.info,
  };
}

/**
 * One row; a short second row is padded with empty columns so the two rows
 * line up. Once the width is known every cell gets its exact share (capped);
 * before that the cells flex, under the same cap.
 */
function CellRow({ cells, columns, height, radius, width, maxCell }: {
  cells: readonly HubTableCell[];
  columns: number;
  height: number;
  radius: number;
  width: number;
  maxCell: number;
}) {
  const padding = Math.max(0, columns - cells.length);
  const size: ViewStyle = width > 0
    ? { width: floorCellWidth(columns, width, maxCell), height }
    : { flex: 1, minWidth: FLOOR_MIN_CELL, height, ...(Number.isFinite(maxCell) ? { maxWidth: maxCell } : null) };
  return (
    <View style={{ flexDirection: 'row', gap: FLOOR_CELL_GAP }}>
      {cells.map((cell) => (
        <View key={cell.key} style={[size, { borderRadius: radius }, cellStyle(cell)]} />
      ))}
      {Array.from({ length: padding }, (_, index) => (
        <View key={`pad-${index}`} style={size} />
      ))}
    </View>
  );
}

/**
 * Past 60 tables a cell would be a sliver: one bar instead, each state's share
 * of the floor, waiting bills first, then occupied, reserved, free. Every state
 * keeps FLOOR_BAR_MIN_PART, and the end parts round their own outer corners
 * rather than being clipped by the bar, so the bill's blue edge stays whole.
 */
function FloorBar({ cells, width }: { cells: readonly HubTableCell[]; width: number }) {
  const bills = cells.filter((cell) => cell.waitingBill).length;
  const count = (tone: HubTableCell['tone']) => cells.filter((cell) => !cell.waitingBill && cell.tone === tone).length;
  const all: Array<{ key: string; share: number; style: ViewStyle }> = [
    { key: 'bill', share: bills, style: { backgroundColor: tableTileTones.occupied.fill, borderWidth: BILL_EDGE, borderColor: palette.info } },
    { key: 'occupied', share: count('occupied'), style: { backgroundColor: tableTileTones.occupied.fill } },
    { key: 'reserved', share: count('reserved'), style: { backgroundColor: tableTileTones.reserved.fill } },
    { key: 'free', share: count('free'), style: { backgroundColor: tableTileTones.free.fill } },
  ];
  const widths = width > 0 ? floorBarWidths(all.map((part) => part.share), width) : null;
  const parts = all
    .map((part, index) => ({ ...part, width: widths ? widths[index] : null }))
    .filter((part) => part.share > 0);
  return (
    <View style={{ flexDirection: 'row', gap: FLOOR_BAR_GAP, height: FLOOR_BAR_HEIGHT }}>
      {parts.map((part, index) => (
        <View
          key={part.key}
          style={[
            part.width !== null ? { width: part.width } : { flexGrow: part.share, flexBasis: 0, minWidth: FLOOR_BAR_MIN_PART },
            {
              borderTopLeftRadius: index === 0 ? BAR_RADIUS : 0,
              borderBottomLeftRadius: index === 0 ? BAR_RADIUS : 0,
              borderTopRightRadius: index === parts.length - 1 ? BAR_RADIUS : 0,
              borderBottomRightRadius: index === parts.length - 1 ? BAR_RADIUS : 0,
            },
            part.style,
          ]}
        />
      ))}
    </View>
  );
}
