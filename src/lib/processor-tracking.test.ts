import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processorTrackingKey, readProcessorTracking, saveProcessorTracking } from "./processor-tracking";
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("Processor Board same-tab preferences", () => {
  it("remembers timezone and auto-check for the same caller, role and sign-in only", () => {
    const key = processorTrackingKey("actor", "processor", "login-a");
    expect(readProcessorTracking(key)).toEqual({ timezone: "America/New_York", automatic: true });
    saveProcessorTracking(key, { timezone: "America/Chicago", automatic: false });
    expect(readProcessorTracking(key)).toEqual({ timezone: "America/Chicago", automatic: false });
    for (const other of [processorTrackingKey("other", "processor", "login-a"), processorTrackingKey("actor", "admin", "login-a"), processorTrackingKey("actor", "processor", "login-b")]) {
      expect(readProcessorTracking(other)).toEqual({ timezone: "America/New_York", automatic: true });
    }
  });
  it.each(["broken-json", '{"timezone":"Invalid/Zone","automatic":true}', '{"timezone":"America/Chicago","automatic":"yes"}'])("rejects invalid preferences: %s", (value) => {
    sessionStorage.setItem("key", value);
    expect(readProcessorTracking("key")).toEqual({ timezone: "America/New_York", automatic: true });
  });
  it("keeps controls usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(readProcessorTracking("key").automatic).toBe(true);
    expect(() => saveProcessorTracking("key", { timezone: "America/Chicago", automatic: true })).not.toThrow();
  });
});
