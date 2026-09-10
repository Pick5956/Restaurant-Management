import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type NestedHorizontalGestureSetter = (active: boolean) => void;
type VerticalScrollActivityReporter = (activityTimeMs: number) => void;

type PrimaryTabSwipeGestureContextValue = Readonly<{
  reportVerticalScrollActivity: VerticalScrollActivityReporter;
  setNestedHorizontalGestureActive: NestedHorizontalGestureSetter;
}>;

export type PrimaryTabSceneStatus = 'active' | 'adjacent' | 'inactive' | null;

/** How a screen's open stage is closed, or null when no stage is open. */
type PrimaryTabStageDismiss = (() => void) | null;

type PrimaryTabStageContextValue = Readonly<{
  dismiss: PrimaryTabStageDismiss;
  setDismiss: (update: (current: PrimaryTabStageDismiss) => PrimaryTabStageDismiss) => void;
}>;

const PrimaryTabsHostContext = createContext(false);
const PrimaryTabStageContext = createContext<PrimaryTabStageContextValue>({
  dismiss: null,
  setDismiss: () => undefined,
});
const PrimaryTabSceneStatusContext = createContext<PrimaryTabSceneStatus>(null);
const PrimaryTabSwipeGestureContext = createContext<PrimaryTabSwipeGestureContextValue>({
  reportVerticalScrollActivity: () => undefined,
  setNestedHorizontalGestureActive: () => undefined,
});

export function PrimaryTabsHostProvider({ children }: { children: ReactNode }) {
  return (
    <PrimaryTabsHostContext.Provider value>
      {children}
    </PrimaryTabsHostContext.Provider>
  );
}

export function useIsPrimaryTabsHost() {
  return useContext(PrimaryTabsHostContext);
}

export function PrimaryTabSceneProvider({
  children,
  status,
}: {
  children: ReactNode;
  status: Exclude<PrimaryTabSceneStatus, null>;
}) {
  return (
    <PrimaryTabSceneStatusContext.Provider value={status}>
      {children}
    </PrimaryTabSceneStatusContext.Provider>
  );
}

export function usePrimaryTabSceneStatus() {
  return useContext(PrimaryTabSceneStatusContext);
}

export function PrimaryTabSwipeGestureProvider({
  children,
  reportVerticalScrollActivity,
  setNestedHorizontalGestureActive,
}: {
  children: ReactNode;
  reportVerticalScrollActivity: VerticalScrollActivityReporter;
  setNestedHorizontalGestureActive: NestedHorizontalGestureSetter;
}) {
  const value = useMemo(
    () => ({
      reportVerticalScrollActivity,
      setNestedHorizontalGestureActive,
    }),
    [reportVerticalScrollActivity, setNestedHorizontalGestureActive],
  );

  return (
    <PrimaryTabSwipeGestureContext.Provider value={value}>
      {children}
    </PrimaryTabSwipeGestureContext.Provider>
  );
}

export function usePrimaryTabSwipeExclusionHandlers() {
  const { setNestedHorizontalGestureActive } = useContext(PrimaryTabSwipeGestureContext);

  return useMemo(
    () => ({
      onTouchStart: () => setNestedHorizontalGestureActive(true),
      onTouchEnd: () => setNestedHorizontalGestureActive(false),
      onTouchCancel: () => setNestedHorizontalGestureActive(false),
      onPointerDown: () => setNestedHorizontalGestureActive(true),
      onPointerUp: () => setNestedHorizontalGestureActive(false),
      onPointerCancel: () => setNestedHorizontalGestureActive(false),
    }),
    [setNestedHorizontalGestureActive],
  );
}

export function usePrimaryTabVerticalScrollActivityReporter() {
  return useContext(PrimaryTabSwipeGestureContext).reportVerticalScrollActivity;
}

/**
 * One slot for "a screen has taken the display over until this is dismissed".
 *
 * It exists because the phone dock is NOT inside the screen: `AppScreen` can
 * cover its own content and its own header, and the dock is mounted beside the
 * pager by the primary layout, a level up. A screen with an open stage has no
 * way to reach it except through a value both of them can see.
 */
export function PrimaryTabStageProvider({ children }: { children: ReactNode }) {
  const [dismiss, setDismiss] = useState<PrimaryTabStageDismiss>(null);
  const value = useMemo(() => ({ dismiss, setDismiss }), [dismiss]);

  return (
    <PrimaryTabStageContext.Provider value={value}>
      {children}
    </PrimaryTabStageContext.Provider>
  );
}

/** Read by whatever has to go inert while a stage is up. */
export function usePrimaryTabStageDismiss() {
  return useContext(PrimaryTabStageContext).dismiss;
}

/**
 * Publish this screen's open stage.
 *
 * Writes only when there IS a stage and clears only its own handler. Every
 * primary scene stays mounted in the pager, so a hook that wrote `null` on
 * mount would have each of the other four tabs wipe the stage the visible one
 * had just opened.
 */
export function usePublishPrimaryTabStage(dismiss: PrimaryTabStageDismiss) {
  const { setDismiss } = useContext(PrimaryTabStageContext);

  useEffect(() => {
    if (!dismiss) return undefined;
    setDismiss(() => dismiss);
    return () => setDismiss((current) => (current === dismiss ? null : current));
  }, [dismiss, setDismiss]);
}
