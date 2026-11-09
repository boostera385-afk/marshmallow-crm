/**
 * Temporary load-shedding switch for in-app notifications.
 *
 * While true, the CRM does not mount the notification bell, the workflow alert
 * toasts, or the urgent / job-in-progress / quote-updated / incomplete-details
 * pop-ups, and the Notifications page does not load history. Nothing reads the
 * `notifications` table or calls `workflow_notifications` from the browser, and
 * no notification realtime subscription is opened.
 *
 * Notifications are still created server-side, so nothing is lost: they appear
 * again once this is set back to false and the CRM is republished.
 *
 * Added during the database overload of 2026-11-09. Set to false to resume.
 */
export const NOTIFICATIONS_PAUSED = true;
