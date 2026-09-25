import { useCallback, useEffect, useRef, useState } from 'react';

import { BottomSheet } from '@/src/components/ai/chrome';
import { PaymentForm, type PaymentFormProps } from '@/src/components/payment/payment-form';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';

/**
 * How long after opening the sheet's confirm ignores presses. The sheet takes
 * about 460ms to slide in and its confirm lands close to where the footer's
 * `รับเงิน` was, so a double tap on the footer would otherwise fall through
 * onto it. PromptPay has no amount step in between; this is its guard.
 */
export const SHEET_ARM_MS = 500;

/**
 * Taking payment on a phone. The footer button only opens this; nothing is
 * recorded until the cashier has seen the method and, for cash, stated what
 * was handed over (2026-09-23: one tap on the old footer recorded a cash
 * payment nobody chose). A fitted BottomSheet, which covers the tab pager
 * itself, so no raw Modal here.
 */
export function PaymentSheet({ open, onClose, ...form }: PaymentFormProps & {
  open: boolean;
  onClose: () => void;
}) {
  const { copy } = useDisplayPreferences();

  // Each opening starts clean: nothing handed over, keypad empty. The form is
  // keyed by it, and by the total, so a bill re-priced while open starts over
  // rather than keeping an amount chosen against the old figure.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }

  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = Date.now();
  }, [open]);
  const isArmed = useCallback(() => Date.now() - openedAt.current >= SHEET_ARM_MS, []);

  return (
    <BottomSheet fit label={copy('ปิด', 'Close')} onClose={onClose} open={open} showClose>
      <PaymentForm key={`${opening}:${form.total}`} isArmed={isArmed} layout="sheet" {...form} />
    </BottomSheet>
  );
}
