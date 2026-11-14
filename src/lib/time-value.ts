/** Time-of-day values as native time inputs and the database use them ("HH:mm[:ss]"). */
export interface TimeParts {
  hour12: number; // 1-12
  minute: number; // 0-59
  pm: boolean;
}

/** "13:07", "13:07:00" -> parts; anything else -> undefined. */
export function parseTime(value: string | null | undefined): TimeParts | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value ?? "");
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minute = Number(match[2]);
  if (hours > 23 || minute > 59) return undefined;
  return { hour12: hours % 12 === 0 ? 12 : hours % 12, minute, pm: hours >= 12 };
}

/** Parts -> "HH:mm" (24-hour), the value a native time input produces. */
export function formatTimeValue({ hour12, minute, pm }: TimeParts): string {
  const hours = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export const formatTimeLabel = ({ hour12, minute, pm }: TimeParts) => `${hour12}:${String(minute).padStart(2, "0")} ${pm ? "PM" : "AM"}`;

/**
 * A saved time of day ("15:00", "15:00:00") as 12-hour text ("3:00 PM").
 * Empty for no time; text that is not a time is returned unchanged.
 */
export function formatClockTime(value: string | null | undefined): string {
  if (!value) return "";
  const parts = parseTime(value);
  return parts ? formatTimeLabel(parts) : value;
}

/** "3:00 PM - 5:00 PM", one side alone when the other is missing, "" for neither. */
export function formatClockRange(start: string | null | undefined, end: string | null | undefined, separator = " - "): string {
  return [formatClockTime(start), formatClockTime(end)].filter(Boolean).join(separator);
}
