import { describe, expect, it } from "vitest";
import { formatClockRange, formatClockTime } from "./time-value";

describe("12-hour saved times", () => {
  it("turns saved 24-hour times into 12-hour AM/PM text", () => {
    expect(formatClockTime("15:00")).toBe("3:00 PM");
    expect(formatClockTime("15:00:00")).toBe("3:00 PM");
    expect(formatClockTime("00:05")).toBe("12:05 AM");
    expect(formatClockTime("12:30:00")).toBe("12:30 PM");
    expect(formatClockTime("09:00")).toBe("9:00 AM");
  });
  it("leaves empty and non-time values alone", () => {
    expect(formatClockTime(null)).toBe("");
    expect(formatClockTime("")).toBe("");
    expect(formatClockTime("Afternoon")).toBe("Afternoon");
    expect(formatClockTime("25:00")).toBe("25:00");
  });
  it("formats a range, or one side when the other is missing", () => {
    expect(formatClockRange("15:00", "17:00")).toBe("3:00 PM - 5:00 PM");
    expect(formatClockRange("15:00:00", "17:00:00", " – ")).toBe("3:00 PM – 5:00 PM");
    expect(formatClockRange("15:00", null)).toBe("3:00 PM");
    expect(formatClockRange(null, undefined)).toBe("");
  });
});
