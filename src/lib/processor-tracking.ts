import { PROCESSOR_TIMEZONES } from "./processor-board";

export type ProcessorTrackingPreference = { timezone: string; confirmed: boolean; automatic: boolean };
const defaults = (): ProcessorTrackingPreference => ({ timezone: "America/New_York", confirmed: false, automatic: true });

/** Same-tab UI preference, never an inferred timezone or an authorization grant. */
export function processorTrackingKey(userId: string, role: string, signIn = "") {
  return `processor-tracking:v1:${userId}:${role}:${signIn}`;
}
export function readProcessorTracking(key: string): ProcessorTrackingPreference {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && "timezone" in value && typeof value.timezone === "string" && PROCESSOR_TIMEZONES.includes(value.timezone) &&
      "confirmed" in value && typeof value.confirmed === "boolean" && "automatic" in value && typeof value.automatic === "boolean") {
      return { timezone: value.timezone, confirmed: value.confirmed, automatic: value.automatic };
    }
  } catch { /* Unavailable/corrupt browser storage must not block the board. */ }
  return defaults();
}
export function saveProcessorTracking(key: string, preference: ProcessorTrackingPreference) {
  try { sessionStorage.setItem(key, JSON.stringify(preference)); } catch { /* Keep in-memory controls usable. */ }
}
