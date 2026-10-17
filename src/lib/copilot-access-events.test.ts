import { afterEach, describe, expect, it, vi } from "vitest";
import { announceCopilotAccessChange, COPILOT_ACCESS_STORAGE_KEY } from "./copilot-access-events";
import { realtimeBus } from "@/lib/realtime";
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget() }));
afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(COPILOT_ACCESS_STORAGE_KEY); });
describe("Copilot cross-tab invalidation", () => {
  it("announces a save locally and stores only a random invalidation signal", () => {
    const listener = vi.fn(); realtimeBus.addEventListener("copilot_access_changed", listener);
    try { announceCopilotAccessChange(); expect(listener).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(COPILOT_ACCESS_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
    } finally { realtimeBus.removeEventListener("copilot_access_changed", listener); }
  });
  it("does not turn a persisted save into a failure when storage is blocked", () => {
    const listener = vi.fn(); realtimeBus.addEventListener("copilot_access_changed", listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    try { expect(() => announceCopilotAccessChange()).not.toThrow(); expect(listener).toHaveBeenCalledTimes(1); }
    finally { realtimeBus.removeEventListener("copilot_access_changed", listener); }
  });
});
