import { PROCESSOR_TIMEZONES } from "./processor-board";

export type ProcessorTrackingPreference = { timezone: string };
const defaults = (): ProcessorTrackingPreference => ({ timezone: "America/New_York" });

/** Same-tab UI preference, never an inferred timezone or an authorization grant. */
export function processorTrackingKey(userId: string, role: string, signIn = "") {
  return `processor-tracking:v3:${userId}:${role}:${signIn}`;
}
export function readProcessorTracking(key: string): ProcessorTrackingPreference {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && "timezone" in value && typeof value.timezone === "string" && PROCESSOR_TIMEZONES.includes(value.timezone)) {
      return { timezone: value.timezone };
    }
  } catch { /* Unavailable/corrupt browser storage must not block the board. */ }
  return defaults();
}
export function saveProcessorTracking(key: string, preference: ProcessorTrackingPreference) {
  try { sessionStorage.setItem(key, JSON.stringify(preference)); } catch { /* Keep in-memory controls usable. */ }
}
