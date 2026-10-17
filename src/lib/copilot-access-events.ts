import { realtimeBus } from "@/lib/realtime";

// Invalidation signal only: never store permissions, identity or customer data.
// Other users/devices still revalidate through the authenticated polling hook.
export const COPILOT_ACCESS_STORAGE_KEY = "marshmallow:copilot-access-changed";
export function announceCopilotAccessChange() {
  realtimeBus.dispatchEvent(new Event("copilot_access_changed"));
  try { window.localStorage.setItem(COPILOT_ACCESS_STORAGE_KEY, crypto.randomUUID()); }
  catch { /* Storage may be blocked. Server checks and polling remain authoritative. */ }
}
