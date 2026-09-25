// The table-management screen's own arithmetic, kept out of the components so
// it can be tested: how the tile grid divides its width, how wide the ghost
// add tile runs, and what a link into the section asks for.

import { parsePositiveRouteId } from './route-id.ts';

export const PLAN_TILE_GAP = 10;
export const PLAN_PHONE_COLUMNS = 3;
/** From 768pt as many tiles of about this width as fit; they then grow to fill the row. */
export const PLAN_TABLET_TILE_BASIS = 116;
/** The tile's padding and hairline on both sides: what is left of its width for the label. */
export const PLAN_TILE_LABEL_INSET = 22;

export type GridMetrics = {
  columns: number;
  /** 0 until the grid has been measured. */
  tileWidth: number;
  /** The width a tile gives its label, for the shared label size. */
  labelRoom: number;
};

/**
 * Three to a row on a phone; from 768pt as many ~116pt tiles as fit. Either
 * way every tile is (grid − gaps) / columns wide, rounded down to a half
 * point, so a full row reaches the grid's right edge instead of stopping short.
 */
export function gridMetrics(gridWidth: number, tablet: boolean): GridMetrics {
  const width = Number.isFinite(gridWidth) && gridWidth > 0 ? gridWidth : 0;
  const columns = tablet
    ? Math.max(PLAN_PHONE_COLUMNS, Math.floor((width + PLAN_TILE_GAP) / (PLAN_TABLET_TILE_BASIS + PLAN_TILE_GAP)))
    : PLAN_PHONE_COLUMNS;
  const tileWidth = width > 0 ? Math.floor(((width - PLAN_TILE_GAP * (columns - 1)) / columns) * 2) / 2 : 0;
  return { columns, tileWidth, labelRoom: Math.max(0, tileWidth - PLAN_TILE_LABEL_INSET) };
}

/** The width of a tile `span` columns wide, gaps between them included. */
export function spanWidth(metrics: GridMetrics, span: number): number {
  return metrics.tileWidth * span + PLAN_TILE_GAP * (span - 1);
}

/**
 * The columns the ghost add tile takes: the rest of the last row, or a whole
 * row of its own when the tiles before it end one. A room never ends in a row
 * with a hole in it (owner, 2026-09-23: no leftover space), and an empty
 * room's ghost is one full-width bar.
 */
export function ghostSpan(tilesBefore: number, columns: number): number {
  const count = Math.max(0, Math.floor(tilesBefore));
  const perRow = Math.max(1, Math.floor(columns));
  const remainder = count % perRow;
  return remainder === 0 ? perRow : perRow - remainder;
}

/**
 * What a link into the section asks for: `?table=<id>` opens that table's
 * sheet (the order floor's long press, the AI), `?add=1` the add sheet.
 */
export type PlanDeepLink = { kind: 'table'; id: number } | { kind: 'add' } | null;

type LinkParam = string | string[] | undefined;

function firstParam(value: LinkParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function planDeepLink(params: { table?: LinkParam; add?: LinkParam }): PlanDeepLink {
  const table = parsePositiveRouteId(firstParam(params.table));
  if (table.kind === 'valid') return { kind: 'table', id: table.id };
  if (firstParam(params.add) === '1') return { kind: 'add' };
  return null;
}

/** The same link twice is acted on once. */
export function planDeepLinkKey(link: PlanDeepLink): string | null {
  if (!link) return null;
  return link.kind === 'table' ? `table:${link.id}` : 'add';
}
