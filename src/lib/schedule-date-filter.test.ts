import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterUrgentBySchedule } from "./schedule-date-filter";

const rows = [
  { id: "range", customer_schedule_requirements: "November 27, 2026 to November 29, 2026" },
  { id: "dec1", customer_schedule_requirements: "Dec 1" },
  { id: "past", customer_schedule_requirements: "Nov 20" },
  { id: "today", customer_schedule_requirements: "Nov 28 morning" },
  { id: "none", customer_schedule_requirements: "Anytime, call first" },
  { id: "empty", customer_schedule_requirements: null },
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe("filterUrgentBySchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 28, 10, 0, 0)); // Nov 28 2026
  });
  afterEach(() => vi.useRealTimers());

  it("returns every row when no filter is set", () => {
    expect(ids(filterUrgentBySchedule(rows, { mode: "all" }))).toEqual(ids(rows));
  });

  it("due keeps today and overdue schedules, not future or undated ones", () => {
    expect(ids(filterUrgentBySchedule(rows, { mode: "due" }))).toEqual(["range", "past", "today"]);
  });

  it("range keeps schedules overlapping the picked days", () => {
    const one = new Date(2026, 10, 29);
    expect(ids(filterUrgentBySchedule(rows, { mode: "range", range: { from: one } }))).toEqual(["range"]);
    const r = { from: new Date(2026, 10, 30), to: new Date(2026, 11, 2) };
    expect(ids(filterUrgentBySchedule(rows, { mode: "range", range: r }))).toEqual(["dec1"]);
  });

  it("range without a start date does not filter", () => {
    expect(filterUrgentBySchedule(rows, { mode: "range", range: {} })).toHaveLength(rows.length);
  });

  it("undated keeps rows with no readable date", () => {
    expect(ids(filterUrgentBySchedule(rows, { mode: "undated" }))).toEqual(["none", "empty"]);
  });
});
