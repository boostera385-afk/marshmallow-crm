/**
 * Timestamps for display: the viewer's own date order and language, but always a
 * 12-hour clock with AM/PM, even when the browser's region defaults to 24-hour time.
 */
export type DateTimeInput = string | number | Date;

/** Date and time, e.g. "11/14/2026, 3:05:09 PM". Extra options narrow the fields shown. */
export function formatDateTime(value: DateTimeInput, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString(undefined, { ...options, hour12: true });
}

/** Time of day only, e.g. "3:05:09 PM". */
export function formatTimeOfDay(value: DateTimeInput, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleTimeString(undefined, { ...options, hour12: true });
}
