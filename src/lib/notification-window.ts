/**
 * How long notifications are shown (business decision 2026-11-09):
 * - Bell, unread badge, pop-ups and workflow toasts: the last 3 days only.
 * - Notification history (Notifications page): the last 30 days.
 * - A user never sees anything created before their account existed.
 * Older rows stay in the database until the separately approved 30-day
 * retention clean-up; they are only hidden here.
 */
export const NOTIFICATION_ACTIVE_DAYS = 3;
export const NOTIFICATION_HISTORY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const latest = (...isoValues: (string | null | undefined)[]) => {
  const times = isoValues.map((value) => (value ? Date.parse(value) : NaN)).filter(Number.isFinite);
  return new Date(Math.max(...times)).toISOString();
};

/** Earliest created_at the bell, badge, pop-ups and toasts show. */
export function activeNotificationSince(userCreatedAt?: string | null, now = Date.now()): string {
  return latest(new Date(now - NOTIFICATION_ACTIVE_DAYS * DAY_MS).toISOString(), userCreatedAt);
}

/** Earliest created_at the notification history shows. */
export function historyNotificationSince(userCreatedAt?: string | null, now = Date.now()): string {
  return latest(new Date(now - NOTIFICATION_HISTORY_DAYS * DAY_MS).toISOString(), userCreatedAt);
}

/** The later of a requested lower bound and a floor (both ISO timestamps). */
export function laterOf(requested: string | null | undefined, floor: string): string {
  return latest(requested, floor);
}
