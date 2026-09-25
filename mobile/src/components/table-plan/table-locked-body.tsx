import { AppIcon } from '@/src/components/app-icon';
import { usePlanEnv } from '@/src/components/table-plan/plan-context';
import { BodyFrame, GroupCard, KitRow, KitValue, StatusChip, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import { QrView, TableTent } from '@/src/components/table-plan/table-tent';
import { useTableLink, type QrPaper } from '@/src/components/table-plan/table-link';
import { QR_PAPER_PRINTS } from '@/src/components/table-plan/use-qr-paper';
import { reservationClock } from '@/src/lib/reservation-schedule';
import { planStatus, planTableTitle } from '@/src/lib/table-plan';
import type { RestaurantTable } from '@/src/types/table';

// A table in service, read only (owner, 2026-09-23). It shows what it is - the
// tent with its QR, "T5 ไม่มีโซน", its status in its own words and its seats -
// and the link can still be shared, opened and printed. Nothing here changes
// the table: no stepper, no zone, no switch, no delete, no new QR and no save.
// It closes through service (pay the bill, finish or cancel the booking), and
// the sheet turns into the editor by itself when a reload sees it free.
// table-management-guards.test.mjs keeps every edit control out of this file.

export function LockedTableBody({ chrome, table, qrOpen, setQrOpen, paper }: {
  chrome: BodyChrome;
  table: RestaurantTable;
  qrOpen: boolean;
  setQrOpen: (open: boolean) => void;
  paper: QrPaper;
}) {
  const env = usePlanEnv();
  const { t, language } = env;
  const { label, zone } = planTableTitle(table, env.zones, language);
  const link = useTableLink(table, label, t);
  const status = planStatus(table, env.activeOrderIds);
  const guest = status === 'reserved'
    ? String(table.reservation_name ?? '').trim() || t('ไม่ระบุชื่อ', 'no name')
    : null;

  if (qrOpen && link.url) {
    return (
      <BodyFrame chrome={chrome}>
        <QrView
          canRegenerate={false}
          label={label}
          onBack={() => setQrOpen(false)}
          canPrint={QR_PAPER_PRINTS}
          busy={paper.busy}
          onPaper={(mode) => paper.run({ label, zone: zone, url: link.url ?? '' }, mode)}
          onRegenerate={async () => false}
          regenerating={false}
          t={t}
          url={link.url}
          zone={zone}
        />
      </BodyFrame>
    );
  }

  return (
    <BodyFrame chrome={chrome}>
      <TableTent
        bookingTime={reservationClock(table.upcoming_reservation_at, language)}
        canCreateQr={false}
        closed={false}
        creatingQr={false}
        label={label}
        onCreateQr={() => undefined}
        onOpenMenu={link.openMenu}
        onOpenQr={() => setQrOpen(true)}
        onShare={link.share}
        t={t}
        url={link.url}
        zone={zone}
      />
      <GroupCard>
        <KitRow first title={t('สถานะ', 'Status')}>
          <StatusChip extra={guest} language={language} status={status} />
        </KitRow>
        <KitRow title={t('ที่นั่ง', 'Seats')}>
          <AppIcon color="#6B4636" name="people-outline" size={16} />
          <KitValue text={String(table.capacity)} />
        </KitRow>
      </GroupCard>
    </BodyFrame>
  );
}
