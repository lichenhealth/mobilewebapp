// ─── The app-icon badge (founder 2026-11-02: "I don't see notifications on my
// Home Screen with the app and I should, right?") ────────────────────────────
// The installed PWA's home-screen icon wears the member's unread-bell count via
// the Badging API. Two writers, one number:
//   • in-app: NotificationsProvider calls syncAppBadge whenever the unread
//     total changes (and on sign-out, which clears it);
//   • app closed: sw.js sets it from the `badge` count send-push includes in
//     every push payload (iOS only updates a closed PWA's badge through push).
// The count is the BELL's number — unread, non-desk rows — so the icon and the
// in-app bell can never disagree. Unsupported contexts (plain Safari tab,
// desktop browsers without the API, not installed) reject or lack the method;
// everything is guarded so the badge is strictly best-effort.

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function syncAppBadge(count: number): void {
  try {
    const nav = navigator as BadgeNavigator;
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* unsupported — the in-app bell still tells the truth */
  }
}
