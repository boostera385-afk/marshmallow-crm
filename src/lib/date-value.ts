import { format, isValid, parse } from "date-fns";

/** Calendar days as native date inputs use them ("YYYY-MM-DD", local, no time zone). */
const ISO_DAY = "yyyy-MM-dd";

/** "2026-11-01" -> local Date (no time-zone shift), or undefined. */
export function parseIsoDay(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parse(value, ISO_DAY, new Date());
  return isValid(date) ? date : undefined;
}

export const toIsoDay = (date: Date) => format(date, ISO_DAY);
