import { startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";

export type ScheduleDateEntry = { month: number; day: number; year?: number; endDay?: number };

const SCHEDULE_WEEKDAYS: Record<string, string> = {
  sunday: "Sun", sun: "Sun",
  monday: "Mon", mon: "Mon",
  tuesday: "Tue", tue: "Tue", tues: "Tue",
  wednesday: "Wed", wed: "Wed",
  thursday: "Thu", thu: "Thu", thur: "Thu", thurs: "Thu",
  friday: "Fri", fri: "Fri",
  saturday: "Sat", sat: "Sat",
};

const SCHEDULE_MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const SCHEDULE_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHEDULE_MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export function findDatesInScheduleText(rawSeg: string): ScheduleDateEntry[] {
  if (!rawSeg || !rawSeg.trim()) return [];
  const TIME_RANGE_RX_G = /(?<!\d[-/])\b(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:a\.?m\.?|p\.?m\.?)?(?![-/]\d)/gi;
  const TIME_SINGLE_RX_G = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:noon|midnight)\b/gi;
  const seg = rawSeg.replace(TIME_RANGE_RX_G, " ").replace(TIME_SINGLE_RX_G, " ");
  const results: ScheduleDateEntry[] = [];
  const nowMonth = new Date().getMonth();

  const push = (mo: number, d: number, endD?: number, yr?: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    if (endD !== undefined && (endD < d || endD > 31)) return;
    if (endD === undefined && results.some((r) => r.month === mo && r.day === d && r.endDay === undefined)) return;
    results.push({ month: mo, day: d, endDay: endD, year: yr });
  };

  // 1. ISO date: YYYY-MM-DD or YYYY/MM/DD
  const iso = rawSeg.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    push(Number(iso[2]) - 1, Number(iso[3]), undefined, Number(iso[1]));
  }

  // 2. Slash date: MM/DD/YYYY or DD/MM/YYYY
  const slash = rawSeg.match(/(?<!\d[-/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (slash) {
    const p1 = Number(slash[1]);
    const p2 = Number(slash[2]);
    const yr = slash[3] ? (Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3])) : undefined;
    if (p1 > 12 && p2 <= 12) {
      push(p2 - 1, p1, undefined, yr);
    } else if (p1 <= 12) {
      push(p1 - 1, p2, undefined, yr);
    }
  }

  // Date range: "August 25, 2026 to August 29, 2026" or "August 25 to August 29"
  const rangeMonthFirst = seg.match(
    new RegExp(
      `\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\s+(?:to|through|until|–|-)\\s+${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`,
      "i"
    )
  );
  if (rangeMonthFirst) {
    const m1 = SCHEDULE_MONTHS[rangeMonthFirst[1].toLowerCase()];
    const m2 = SCHEDULE_MONTHS[rangeMonthFirst[4].toLowerCase()];
    if (m1 !== undefined && m2 !== undefined) {
      const yr = rangeMonthFirst[6]
        ? Number(rangeMonthFirst[6]) < 100
          ? 2000 + Number(rangeMonthFirst[6])
          : Number(rangeMonthFirst[6])
        : rangeMonthFirst[3]
        ? Number(rangeMonthFirst[3]) < 100
          ? 2000 + Number(rangeMonthFirst[3])
          : Number(rangeMonthFirst[3])
        : undefined;

      if (m1 === m2) {
        push(m1, Number(rangeMonthFirst[2]), Number(rangeMonthFirst[5]), yr);
        return results;
      }
    }
  }

  // Date range: "27th July to 31st July"
  const rangeA = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeA && SCHEDULE_MONTHS[rangeA[2].toLowerCase()] === SCHEDULE_MONTHS[rangeA[4].toLowerCase()]) {
    const yr = rangeA[5] ? (Number(rangeA[5]) < 100 ? 2000 + Number(rangeA[5]) : Number(rangeA[5])) : undefined;
    push(SCHEDULE_MONTHS[rangeA[2].toLowerCase()], Number(rangeA[1]), Number(rangeA[3]), yr);
    return results;
  }

  // "27th to 31st July"
  const rangeB = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeB) {
    const yr = rangeB[4] ? (Number(rangeB[4]) < 100 ? 2000 + Number(rangeB[4]) : Number(rangeB[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeB[3].toLowerCase()], Number(rangeB[1]), Number(rangeB[2]), yr);
    return results;
  }

  // "July 27-31" / "July 27 to 31"
  const rangeC = seg.match(new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeC) {
    const yr = rangeC[4] ? (Number(rangeC[4]) < 100 ? 2000 + Number(rangeC[4]) : Number(rangeC[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeC[1].toLowerCase()], Number(rangeC[2]), Number(rangeC[3]), yr);
    return results;
  }

  // Grouped: "21st or 22nd July", "20, 21 July"
  const grouped = seg.match(new RegExp(`((?:\\d{1,2}(?:st|nd|rd|th)?)(?:\\s*(?:,|&|and|or|\\/)\\s*\\d{1,2}(?:st|nd|rd|th)?)+)\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (grouped) {
    const mo = SCHEDULE_MONTHS[grouped[2].toLowerCase()];
    const yr = grouped[3] ? (Number(grouped[3]) < 100 ? 2000 + Number(grouped[3]) : Number(grouped[3])) : undefined;
    const days = grouped[1]
      .split(/,|&|\band\b|\bor\b|\//i)
      .map((s) => Number(s.replace(/\D/g, "")))
      .filter((d) => d >= 1 && d <= 31);
    if (mo !== undefined) days.forEach((d) => push(mo, d, undefined, yr));
    return results;
  }

  // "21st July 2026" / "21 July"
  let m: RegExpExecArray | null;
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = dm.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[2].toLowerCase()], Number(m[1]), undefined, yr);
  }

  // "July 21, 2026" / "July 21"
  const md = new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = md.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[1].toLowerCase()], Number(m[2]), undefined, yr);
  }

  // Bare ordinal — use current month
  if (results.length === 0) {
    const ord = seg.match(/\b(\d{1,2})(st|nd|rd|th)\b/i);
    if (ord) push(nowMonth, Number(ord[1]));
  }

  results.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.month - b.month || a.day - b.day);
  return results;
}

export function doesLeadMatchScheduleDateRange(
  scheduleText: string | null | undefined,
  range?: { from?: Date; to?: Date }
): boolean {
  if (!range || !range.from) return true;
  if (!scheduleText || !scheduleText.trim()) return false;

  const dates = findDatesInScheduleText(scheduleText);
  if (!dates || dates.length === 0) return false;

  const filterStart = startOfDay(range.from).getTime();
  const filterEnd = endOfDay(range.to || range.from).getTime();
  const currentYear = new Date().getFullYear();

  for (const entry of dates) {
    const yr = entry.year ?? currentYear;
    const startEntry = startOfDay(new Date(yr, entry.month, entry.day)).getTime();
    const endEntry = entry.endDay
      ? endOfDay(new Date(yr, entry.month, entry.endDay)).getTime()
      : endOfDay(new Date(yr, entry.month, entry.day)).getTime();

    // Check if intervals overlap: startEntry <= filterEnd AND endEntry >= filterStart
    if (startEntry <= filterEnd && endEntry >= filterStart) {
      return true;
    }
  }

  return false;
}

/**
 * True when a schedule requirement names a date that is today or already in the
 * past — used to flag urgent leads that "need attention". Undated requirements
 * and clearly next-year intentions (a bare month/day more than ~6 months back)
 * do not count. Shared by the lead card's auto tag and the Need Attention view
 * so both agree on exactly which leads qualify.
 */
export function scheduleRequirementDueOrOverdue(text?: string | null): boolean {
  if (!text || !text.trim()) return false;
  const dates = findDatesInScheduleText(text);
  if (!dates.length) return false;

  const now = startOfDay(new Date());
  const currentYear = now.getFullYear();

  for (const d of dates) {
    const y = d.year ?? currentYear;
    const dt = startOfDay(new Date(y, d.month, d.day));
    // Positive when dt is in the past, 0 when today, negative when in the future.
    const daysPast = differenceInCalendarDays(now, dt);
    if (daysPast < 0) continue; // future date
    // A bare (year-less) date far in the past likely means next year — skip it.
    if (!d.year && daysPast > 180) continue;
    return true;
  }
  return false;
}

/**
 * Whether a lead should surface in the "Need Attention" view: an urgent job whose
 * requested schedule date is today or overdue. Role-gating (Admin / CS / CS Admin)
 * is handled by the caller.
 */
export function leadNeedsAttention(lead: { status?: string | null; customer_schedule_requirements?: string | null }): boolean {
  return lead.status === "urgent_job" && scheduleRequirementDueOrOverdue(lead.customer_schedule_requirements);
}

/**
 * Schedule filter for the Urgent leads overview table. `due` = today/overdue
 * (same rule as Need Attention), `range` = schedule overlaps the picked days,
 * `undated` = no readable date in the schedule text.
 */
export type UrgentScheduleFilter =
  | { mode: "all" }
  | { mode: "due" }
  | { mode: "undated" }
  | { mode: "range"; range: { from?: Date; to?: Date }; label?: string };

export function filterUrgentBySchedule<T extends { customer_schedule_requirements?: string | null }>(
  rows: T[],
  filter: UrgentScheduleFilter,
): T[] {
  switch (filter.mode) {
    case "due":
      return rows.filter((r) => scheduleRequirementDueOrOverdue(r.customer_schedule_requirements));
    case "undated":
      return rows.filter((r) => findDatesInScheduleText(r.customer_schedule_requirements ?? "").length === 0);
    case "range":
      if (!filter.range.from) return rows;
      return rows.filter((r) => doesLeadMatchScheduleDateRange(r.customer_schedule_requirements, filter.range));
    default:
      return rows;
  }
}

export const SCHEDULE_PRESETS = [
  {
    label: "2 Days",
    sublabel: "Today & Tomorrow",
    days: 2,
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)),
    }),
  },
  {
    label: "3 Days",
    sublabel: "Next 3 Days",
    days: 3,
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
    }),
  },
  {
    label: "7 Days",
    sublabel: "Next 7 Days",
    days: 7,
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)),
    }),
  },
  {
    label: "15 Days",
    sublabel: "Next 15 Days",
    days: 15,
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
    }),
  },
  {
    label: "30 Days",
    sublabel: "Next 30 Days",
    days: 30,
    getRange: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date(Date.now() + 29 * 24 * 60 * 60 * 1000)),
    }),
  },
];

export function extractAllScheduledDateKeys(
  leads: Array<{ customer_schedule_requirements?: string | null }>
): Set<string> {
  const dateSet = new Set<string>();
  const currentYear = new Date().getFullYear();

  for (const lead of leads) {
    const text = lead.customer_schedule_requirements;
    if (!text || !text.trim()) continue;

    const entries = findDatesInScheduleText(text);
    for (const entry of entries) {
      const yr = entry.year ?? currentYear;
      const startDay = entry.day;
      const endDay = entry.endDay ?? entry.day;

      for (let d = startDay; d <= endDay; d++) {
        const mStr = String(entry.month + 1).padStart(2, "0");
        const dStr = String(d).padStart(2, "0");
        dateSet.add(`${yr}-${mStr}-${dStr}`);
      }
    }
  }

  return dateSet;
}
