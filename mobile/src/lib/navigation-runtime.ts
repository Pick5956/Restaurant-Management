import { WORKSPACE_HUB_ROUTE } from './workspace-route.ts';

type StackResetRouter<Href> = {
  canDismiss: () => boolean;
  dismissAll: () => void;
  replace: (href: Href) => void;
};

// The five-tab pager's gesture and settle math lived here until 2026-09-23,
// when the phone dock was removed and its screens became ordinary pushes from
// the hub. Git history has it if the pager ever comes back.

/**
 * Leaves one screen in the stack: the sign-in, the restaurant chooser, the hub.
 * Only for a screen that is a root and shows no back button - a workspace
 * screen left alone by it has a back button with nothing beneath, which is
 * what a paid bill did to the floor (owner, 2026-09-25).
 */
export function resetRouteStack<Href>(router: StackResetRouter<Href>, href: Href) {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace(href);
}

/** A route's name in the root stack: its file path, without the slash. */
export function stackRouteName(href: string) {
  return href.replace(/^\/+/, '').split(/[?#]/)[0] ?? '';
}

const HUB_ROUTE_NAME = stackRouteName(WORKSPACE_HUB_ROUTE);

export type WorkspaceExitStep = 'pop-to' | 'dismiss-all' | 'replace-with-hub' | 'push';

/**
 * How to land on a workspace screen with the hub beneath it and nothing
 * between, given the root stack's route names, bottom first. The hub is the
 * one screen with no back button, so every other screen needs it below.
 *
 * - The target is already in a stack that starts at the hub: pop back to it,
 *   which keeps that screen as it was and drops what was opened on top.
 * - Otherwise go down to the bottom, make sure the bottom is the hub, and push
 *   the target on it. A stack that lost its hub (a session stranded before
 *   this existed) is mended here too.
 */
export function workspaceExitSteps(routeNames: readonly string[], href: string): WorkspaceExitStep[] {
  const target = stackRouteName(href);
  const top = routeNames.length - 1;
  const hubAtBottom = routeNames[0] === HUB_ROUTE_NAME;
  const steps: WorkspaceExitStep[] = [];

  if (target === HUB_ROUTE_NAME) {
    if (top > 0) steps.push('dismiss-all');
    if (!hubAtBottom) steps.push('replace-with-hub');
    return steps;
  }
  if (hubAtBottom && routeNames[top] === target) return steps;
  if (hubAtBottom && routeNames.lastIndexOf(target) > 0) return ['pop-to'];

  if (top > 0) steps.push('dismiss-all');
  if (!hubAtBottom) steps.push('replace-with-hub');
  steps.push('push');
  return steps;
}

type WorkspaceExitRouter<Href> = {
  dismissAll: () => void;
  dismissTo: (href: Href) => void;
  push: (href: Href) => void;
  replace: (href: Href) => void;
};

/**
 * Goes to a workspace screen - the floor after a payment, a rail item on a
 * tablet - so that it stands on the hub. `routeNames` is read before anything
 * is queued: expo-router runs the queued actions in order against the state
 * each one leaves, but a read in the same tick still sees the old stack.
 */
export function leaveForWorkspaceRoute<Href extends string>(
  router: WorkspaceExitRouter<Href>,
  routeNames: readonly string[],
  href: Href,
) {
  for (const step of workspaceExitSteps(routeNames, href)) {
    if (step === 'pop-to') router.dismissTo(href);
    else if (step === 'dismiss-all') router.dismissAll();
    else if (step === 'replace-with-hub') router.replace(WORKSPACE_HUB_ROUTE as Href);
    else router.push(href);
  }
}

type NavigationStateLike = {
  routes?: ReadonlyArray<{ name: string; state?: NavigationStateLike }>;
};

/**
 * The app stack's route names from the container's root state. expo-router
 * wraps the app's Stack in a one-route navigator named `__root`.
 */
export function rootStackRouteNames(state: NavigationStateLike | undefined | null): string[] {
  const wrapper = state?.routes?.length === 1 && state.routes[0]?.name === '__root' ? state.routes[0].state : state;
  return wrapper?.routes?.map((route) => route.name) ?? [];
}

type BackRouter<Href> = {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: Href) => void;
};

/**
 * A back button that always goes somewhere. `router.back()` on a screen with
 * nothing beneath is an unhandled GO_BACK: silent in a release build, so the
 * button looks dead, and the only way out was to kill the app.
 */
export function goBackOr<Href>(router: BackRouter<Href>, fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
