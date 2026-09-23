import { useMemo, useState } from 'react';

import {
  keypadAmount,
  keypadNext,
  quickTenderAmounts,
  tenderChange,
  type KeypadKey,
  type Tender,
} from '@/src/lib/cash-tender';

/** "พอดี", a quick round-up amount, or the keypad. */
export type TenderChoice = 'exact' | 'custom' | number;

export interface CashTenderState extends Tender {
  choice: TenderChoice | null;
  quick: number[];
  pick: (choice: TenderChoice) => void;
  press: (key: KeypadKey) => void;
}

/**
 * What the customer handed over for this total. It starts with nothing
 * chosen: the cashier states the amount before cash can be taken, which is
 * what stops a stray tap on the bill from recording a payment by itself.
 */
export function useCashTender(total: number): CashTenderState {
  const [choice, setChoice] = useState<TenderChoice | null>(null);
  const [digits, setDigits] = useState('');
  const quick = useMemo(() => quickTenderAmounts(total), [total]);

  const handed = choice === 'exact'
    ? total
    : choice === 'custom'
      ? keypadAmount(digits)
      : typeof choice === 'number'
        ? choice
        : null;

  return {
    ...tenderChange(total, handed),
    choice,
    quick,
    pick: setChoice,
    press: (key) => {
      setChoice('custom');
      setDigits((current) => keypadNext(current, key));
    },
  };
}
