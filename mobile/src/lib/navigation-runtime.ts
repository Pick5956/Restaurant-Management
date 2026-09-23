type StackResetRouter<Href> = {
  canDismiss: () => boolean;
  dismissAll: () => void;
  replace: (href: Href) => void;
};

// The five-tab pager's gesture and settle math lived here until 2026-09-23,
// when the phone dock was removed and its screens became ordinary pushes from
// the hub. Git history has it if the pager ever comes back.
export function resetRouteStack<Href>(router: StackResetRouter<Href>, href: Href) {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace(href);
}
