import { useEffect, useRef, useState } from 'react';

import { usePlanEnv } from '@/src/components/table-plan/plan-context';
import type { BodyChrome } from '@/src/components/table-plan/sheet-kit';
import { TableEditorBody } from '@/src/components/table-plan/table-editor-body';
import { LockedTableBody } from '@/src/components/table-plan/table-locked-body';
import type { QrPaper } from '@/src/components/table-plan/table-link';
import { planTableTitle, tableLocked } from '@/src/lib/table-plan';
import { useToast } from '@/src/providers/toast-provider';
import type { RestaurantTable } from '@/src/types/table';

// The table sheet. Which of its two faces shows is decided here and nowhere
// else: a table in service - an active order on it, or occupied or reserved -
// gets the read-only body (owner, 2026-09-23: table management is for editing
// data, and a table in use is closed through service first). Every other
// table, closed ones included, gets the editor. A reload that locks or frees
// the table while the sheet is open switches the face in place.

export function TableBody({ chrome, tableId, onClose, paper }: {
  chrome: BodyChrome;
  tableId: number;
  onClose: () => void;
  paper: QrPaper;
}) {
  const env = usePlanEnv();
  const { showToast } = useToast();
  const liveTable = env.tables.find((item) => item.ID === tableId) ?? null;
  // The row as last seen. A deleted table's sheet is closing, and keeps its
  // content while it slides away instead of collapsing to an empty strip.
  const lastTableRef = useRef<RestaurantTable | null>(liveTable);
  if (liveTable) lastTableRef.current = liveTable;
  const table = liveTable ?? lastTableRef.current;
  const [qrOpen, setQrOpen] = useState(false);
  const lastLabelRef = useRef('');
  // Set just before this sheet removes the table itself, so that is not
  // reported as the table having gone.
  const removingRef = useRef(false);
  if (liveTable) lastLabelRef.current = planTableTitle(liveTable, env.zones, env.language).label;

  // Deleted elsewhere while the sheet was open: close, and say which.
  const gone = liveTable === null;
  useEffect(() => {
    if (!gone || removingRef.current) return;
    onClose();
    const label = lastLabelRef.current;
    showToast({ tone: 'warning', title: label ? env.t(`${label} ถูกลบไปแล้ว`, `${label} was deleted`) : env.t('โต๊ะนี้ถูกลบไปแล้ว', 'This table was deleted') });
    // Fires once, when the row leaves the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);

  if (!table) return null;
  if (tableLocked(table, env.activeOrderIds)) {
    return <LockedTableBody chrome={chrome} paper={paper} qrOpen={qrOpen} setQrOpen={setQrOpen} table={table} />;
  }
  return (
    <TableEditorBody
      chrome={chrome}
      onClose={onClose}
      onRemoving={() => {
        removingRef.current = true;
      }}
      paper={paper}
      qrOpen={qrOpen}
      setQrOpen={setQrOpen}
      table={table}
    />
  );
}
