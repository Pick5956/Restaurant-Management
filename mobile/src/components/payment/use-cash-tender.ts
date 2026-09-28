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
 * What the customer handed over for this total. Cash is taken as exactly the
 * amount due (owner, 28 ก.ย. 2569): the "พอดี" / round-up / other-amount chips
 * are gone from the app, so there is nothing to choose. The sheet's arming
 * delay (SHEET_ARM_MS) still keeps the tap that opened it from paying.
 */
export function useCashTender(total: number): CashTenderState {
  const [choice, setChoice] = useState<TenderChoice | null>('exact');
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
