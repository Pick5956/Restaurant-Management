// The settings are a floating window, not a page (27 ก.ย. 2569). Anything can
// ask for it - the account menu, the old /settings links the AI still hands
// out - and the one window mounted by the dashboard layout answers.

export type SettingsSection = "account" | "display" | "restaurant";

export type OpenSettingsDetail = {
  section?: SettingsSection;
  /** A group inside the section to scroll to and light, e.g. "billing". */
  focus?: string;
};

type Listener = (detail: OpenSettingsDetail) => void;
const listeners = new Set<Listener>();

// A request made while no window is listening (an old /settings address typed
// in: the page's effect runs before the layout's) waits here for the window to
// pick up when it mounts.
let pending: OpenSettingsDetail | null = null;

/**
 * Opens the settings window. Returns whether a window was already there to
 * hear it; when not, the request waits for the next window that mounts.
 */
export function openSettings(detail: OpenSettingsDetail = {}): boolean {
  if (listeners.size === 0) {
    pending = detail;
    return false;
  }
  pending = null;
  listeners.forEach((listener) => listener(detail));
  return true;
}

/** For the window: hears every request, and any that came before it mounted. */
export function listenForSettings(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * What an old settings address asks for: /settings/account → the account
 * section, /settings/restaurant?group=billing → the restaurant section at its
 * billing group. `path` is the page path without the /r/<slug> prefix.
 */
export function settingsRequestForPath(path: string, search = ""): OpenSettingsDetail {
  const section = path.split("/")[2];
  const group = new URLSearchParams(search).get("group") ?? undefined;
  if (section === "account" || section === "display") return { section };
  if (section === "restaurant") return { section, focus: group };
  return {};
}
