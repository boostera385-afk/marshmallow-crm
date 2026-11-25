import { describe, expect, it } from "vitest";
import { formatBadgeCount } from "./badge-count";

describe("formatBadgeCount", () => {
  it("shows exact counts up to 99", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(19)).toBe("19");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("caps larger counts at 99+", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(4001)).toBe("99+");
  });

  it("treats invalid or empty counts as 0", () => {
    expect(formatBadgeCount(0)).toBe("0");
    expect(formatBadgeCount(-3)).toBe("0");
    expect(formatBadgeCount(Number.NaN)).toBe("0");
  });
});
