import { type ReactNode } from 'react';

import {
  PrimaryTabSwipeGestureProvider,
  usePrimaryTabSwipeCover,
  usePrimaryTabSwipeExclusionHandlers,
  usePrimaryTabVerticalScrollActivityReporter,
} from '@/src/components/primary-tabs-runtime';

type NestedHorizontalGestureSetter = (active: boolean) => void;
type VerticalScrollActivityReporter = (activityTimeMs: number) => void;

export function TabSwipeGestureProvider({
  children,
  reportVerticalScrollActivity,
  setNestedHorizontalGestureActive,
}: {
  children: ReactNode;
  reportVerticalScrollActivity: VerticalScrollActivityReporter;
  setNestedHorizontalGestureActive: NestedHorizontalGestureSetter;
}) {
  return (
    <PrimaryTabSwipeGestureProvider
      reportVerticalScrollActivity={reportVerticalScrollActivity}
      setNestedHorizontalGestureActive={setNestedHorizontalGestureActive}
    >
      {children}
    </PrimaryTabSwipeGestureProvider>
  );
}

export function useTabSwipeExclusionHandlers() {
  return usePrimaryTabSwipeExclusionHandlers();
}

/** Stops the tab pager while an overlay covers the screen. */
export function useTabSwipeCover(covered: boolean) {
  usePrimaryTabSwipeCover(covered);
}

export function useTabSwipeVerticalScrollActivityReporter() {
  return usePrimaryTabVerticalScrollActivityReporter();
}
