import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimWorkflowAlert, loadAlertCursor, pollAlertDelay, saveAlertCursor, setWorkflowSounds, workflowSoundsEnabled } from "./workflow-alerts";
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_key: string, action: () => unknown) => Promise.resolve(action()) } });
});
describe("persistent workflow alert claims", () => {
  it("announces an event once across refreshes and remounts, scoped by recipient", async () => {
    const show = vi.fn();
    await claimWorkflowAlert("user-a", { id: "event" }, show);
    await claimWorkflowAlert("user-a", { id: "event" }, show);
    expect(show).toHaveBeenCalledTimes(1);
    await claimWorkflowAlert("user-b", { id: "event" }, show);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("does not claim or announce a retired user scope", async () => {
    const show = vi.fn(); await claimWorkflowAlert("user-a", { id: "event" }, show, () => false);
    expect(show).not.toHaveBeenCalled();
    await claimWorkflowAlert("user-a", { id: "event" }, show);
    expect(show).toHaveBeenCalledOnce();
  });
  it("does not attempt overlapping background announcements without Web Locks", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const show = vi.fn(); expect(await claimWorkflowAlert("user-a", { id: "event" }, show)).toBe(false);
    expect(show).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });
  it("persists sound choice and cursor without customer content", () => {
    expect(workflowSoundsEnabled("user-a")).toBe(false);
    setWorkflowSounds("user-a", true); expect(workflowSoundsEnabled("user-a")).toBe(true);
    saveAlertCursor("user-a", "2026-10-20T12:00:00Z");
    expect(loadAlertCursor("user-a", "fallback")).toBe("2026-10-20T12:00:00Z");
    expect(loadAlertCursor("user-b", "fallback")).toBe("fallback");
  });
});
