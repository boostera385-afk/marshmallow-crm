import { describe, expect, it } from "vitest";
import { activeNotificationSince, historyNotificationSince, laterOf } from "@/lib/notification-window";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");

describe("notification display window", () => {
  it("shows the last 3 days in the bell and pop-ups", () => {
    expect(activeNotificationSince(null, NOW)).toBe("2026-11-06T12:00:00.000Z");
  });
  it("keeps 30 days of history", () => {
    expect(historyNotificationSince(undefined, NOW)).toBe("2026-10-10T12:00:00.000Z");
  });
  it("never starts before the user's account existed", () => {
    expect(activeNotificationSince("2026-11-08T09:00:00.000Z", NOW)).toBe("2026-11-08T09:00:00.000Z");
    expect(historyNotificationSince("2026-11-01T00:00:00Z", NOW)).toBe("2026-11-01T00:00:00.000Z");
    expect(activeNotificationSince("2025-01-01T00:00:00Z", NOW)).toBe("2026-11-06T12:00:00.000Z");
  });
  it("keeps a user's narrower filter, but never goes below the floor", () => {
    expect(laterOf("2026-11-07T00:00:00Z", "2026-11-01T00:00:00.000Z")).toBe("2026-11-07T00:00:00.000Z");
    expect(laterOf("2026-01-01T00:00:00Z", "2026-11-01T00:00:00.000Z")).toBe("2026-11-01T00:00:00.000Z");
    expect(laterOf(undefined, "2026-11-01T00:00:00.000Z")).toBe("2026-11-01T00:00:00.000Z");
  });
});
