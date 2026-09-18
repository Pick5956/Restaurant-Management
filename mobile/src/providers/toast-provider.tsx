import { createContext, useCallback, useContext, useMemo } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

// The app's feedback seam, with the toast taken out (14 ก.ย. 2569).
//
// A glass capsule dropped from the top for two days. On iOS 26 the material
// never rendered — the capsule was created while invisible (faded, then
// off-screen) and the text floated over the page with nothing behind it — and
// the owner pulled it from the app to design a different approach. Until that
// lands, nothing is drawn here.
//
// Every screen still calls `showToast`, so the new approach replaces this one
// file and reaches all of them. Meanwhile:
//   - a success is announced to VoiceOver/TalkBack and not drawn — the screen
//     itself already shows the result (the ticket leaves the board, the row
//     updates);
//   - an error or warning becomes a system alert. Dropping those silently would
//     let "the payment was not recorded" pass unseen. The inventory screen
//     already reports its failures this way.
// The undo button a toast could carry has nowhere to go; kitchen rounds are
// still pulled back from the finished-rounds sheet.

type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = {
  label: string;
  onPress: () => void;
};

export type ToastInput = {
  title: string;
  message?: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const showToast = useCallback((input: ToastInput) => {
    const tone = input.tone ?? 'success';
    if (tone === 'error' || tone === 'warning') {
      Alert.alert(input.title, input.message);
      return;
    }
    AccessibilityInfo.announceForAccessibility(input.message ? `${input.title}. ${input.message}` : input.title);
  }, []);

  const dismissToast = useCallback(() => {}, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return value;
}
