import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processorTrackingKey, readProcessorTracking, saveProcessorTracking } from "./processor-tracking";
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("Processor Board same-tab preferences", () => {
  it("remembers the schedule timezone for the same caller, role and sign-in only", () => {
    const key = processorTrackingKey("actor", "processor", "login-a");
    expect(readProcessorTracking(key)).toEqual({ timezone: "America/New_York" });
    saveProcessorTracking(key, { timezone: "America/Chicago" });
    expect(readProcessorTracking(key)).toEqual({ timezone: "America/Chicago" });
    for (const other of [processorTrackingKey("other", "processor", "login-a"), processorTrackingKey("actor", "admin", "login-a"), processorTrackingKey("actor", "processor", "login-b")]) {
      expect(readProcessorTracking(other)).toEqual({ timezone: "America/New_York" });
    }
  });
  it.each(["broken-json", '{"timezone":"Invalid/Zone"}', '{"timezone":5}'])("rejects invalid preferences: %s", (value) => {
    sessionStorage.setItem("key", value);
    expect(readProcessorTracking("key")).toEqual({ timezone: "America/New_York" });
  });
  it("keeps controls usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(readProcessorTracking("key").timezone).toBe("America/New_York");
    expect(() => saveProcessorTracking("key", { timezone: "America/Chicago" })).not.toThrow();
  });
});
