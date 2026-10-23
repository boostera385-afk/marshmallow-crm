import type { InboxNotification } from "@/lib/workflow-inbox";

const key = (userId: string) => `workflow-alerts:${userId}`;
export const soundKey = (userId: string) => `workflow-sound:${userId}`;
export const workflowSoundsEnabled = (userId: string) => {
  try { return localStorage.getItem(soundKey(userId)) === "on"; } catch { return false; }
};
export function setWorkflowSounds(userId: string, enabled: boolean) {
  try { localStorage.setItem(soundKey(userId), enabled ? "on" : "off"); } catch { /* Visual alerts still work. */ }
  window.dispatchEvent(new Event("workflow-sound-changed"));
}

/** Cross-tab claim is atomic in current browsers with Web Locks. Persist only
 * event IDs, not customer content. No autoplay fallback is attempted. */
export async function claimWorkflowAlert(userId: string, notification: Pick<InboxNotification, "id">, show: () => void, isCurrent = () => true) {
  const claim = () => {
    if (!isCurrent()) return false;
    let seen: string[] = [];
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? "[]");
      if (Array.isArray(raw)) seen = raw.filter((id): id is string => typeof id === "string");
    } catch { /* Unavailable storage never blocks the inbox. */ }
    if (seen.includes(notification.id)) return false;
    try { localStorage.setItem(key(userId), JSON.stringify([...seen, notification.id].slice(-4000))); } catch { /* Best effort without storage. */ }
    show();
    return true;
  };
  if (navigator.locks) return navigator.locks.request(key(userId), claim);
  // Without atomic locks only the focused document announces; other tabs keep
  // their persistent unread bell instead of emitting overlapping sounds/toasts.
  return document.hasFocus() ? claim() : false;
}

export function loadAlertCursor(userId: string, fallback: string) {
  try {
    const cursor = localStorage.getItem(`${key(userId)}:cursor`);
    return cursor && Number.isFinite(Date.parse(cursor)) ? cursor : fallback;
  } catch { return fallback; }
}
/** One chime per burst across tabs (called while holding the recipient lock). */
export function claimWorkflowChime(userId: string, now = Date.now()) {
  if (!workflowSoundsEnabled(userId)) return false;
  try {
    const storageKey = `${key(userId)}:last-chime`;
    const previous = Number(localStorage.getItem(storageKey) ?? 0);
    if (now - previous < 1000) return false;
    localStorage.setItem(storageKey, String(now));
  } catch { /* A focused-tab sound still works if storage is unavailable. */ }
  return true;
}
export function saveAlertCursor(userId: string, cursor: string) {
  try { localStorage.setItem(`${key(userId)}:cursor`, cursor); } catch { /* Replayed IDs are deduplicated. */ }
}
export const ALERT_POLL_MS = 15000;
export const ALERT_POLL_MAX_MS = 120000;
/** Double the gap after each failed cycle so a degraded backend is not hammered
 * every 15 seconds; reset to the normal cadence on the first success. */
export function pollAlertDelay(failures: number) {
  return Math.min(ALERT_POLL_MS * 2 ** Math.max(0, failures), ALERT_POLL_MAX_MS);
}
