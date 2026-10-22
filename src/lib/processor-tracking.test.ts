import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processorTrackingKey, readProcessorTracking, saveProcessorTracking } from "./processor-tracking";
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("Processor Board same-tab preferences", () => {
  it("remembers only an explicit valid confirmation for the same caller, role and sign-in", () => {
    const key = processorTrackingKey("actor", "processor", "login-a");
    expect(readProcessorTracking(key).confirmed).toBe(false);
    saveProcessorTracking(key, { timezone: "America/Chicago", confirmed: true, automatic: false });
    expect(readProcessorTracking(key)).toEqual({ timezone: "America/Chicago", confirmed: true, automatic: false });
    for (const other of [processorTrackingKey("other", "processor", "login-a"), processorTrackingKey("actor", "admin", "login-a"), processorTrackingKey("actor", "processor", "login-b")]) {
      expect(readProcessorTracking(other).confirmed).toBe(false);
    }
  });
  it.each(["broken-json", '{"timezone":"Invalid/Zone","confirmed":true,"automatic":true}', '{"timezone":"America/New_York","confirmed":"yes","automatic":true}'])("rejects invalid preferences: %s", (value) => {
    sessionStorage.setItem("key", value);
    expect(readProcessorTracking("key").confirmed).toBe(false);
  });
  it("keeps controls usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(readProcessorTracking("key").confirmed).toBe(false);
    expect(() => saveProcessorTracking("key", { timezone: "America/Chicago", confirmed: true, automatic: true })).not.toThrow();
  });
});
