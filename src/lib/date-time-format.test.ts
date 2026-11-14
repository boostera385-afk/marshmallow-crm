import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatTimeOfDay } from "./date-time-format";

afterEach(() => vi.restoreAllMocks());

describe("timestamps always use a 12-hour clock", () => {
  it("asks the browser for AM/PM even where the region default is 24-hour", () => {
    const toLocaleString = vi.spyOn(Date.prototype, "toLocaleString");
    const toLocaleTimeString = vi.spyOn(Date.prototype, "toLocaleTimeString");
    formatDateTime("2026-11-14T15:05:09Z");
    formatDateTime("2026-11-14T15:05:09Z", { month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    formatTimeOfDay(Date.UTC(2026, 10, 14, 15, 5));
    expect(toLocaleString.mock.calls.map((call) => call[1]?.hour12)).toEqual([true, true]);
    expect(toLocaleString.mock.calls[1][1]).toMatchObject({ month: "short", hour: "2-digit" });
    expect(toLocaleTimeString.mock.calls[0][1]?.hour12).toBe(true);
  });
  it("renders an afternoon time with PM and no 24-hour hour", () => {
    const afternoon = new Date(2026, 10, 14, 15, 5, 9);
    expect(formatDateTime(afternoon)).toMatch(/3:05:09\s?PM/);
    expect(formatTimeOfDay(afternoon)).toMatch(/3:05:09\s?PM/);
    expect(formatDateTime(afternoon)).not.toContain("15:05");
  });
});
