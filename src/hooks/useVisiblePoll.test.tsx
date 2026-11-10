import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisiblePoll } from "@/hooks/useVisiblePoll";

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useVisiblePoll (Leads page urgent table / reply check)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reads on mount, then every 15 seconds instead of every 5", async () => {
    const refresh = vi.fn();
    renderHook(() => useVisiblePoll(refresh, 15_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(14_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(45_000);
    expect(refresh).toHaveBeenCalledTimes(5); // 1 + 4 in one minute (was 13 at 5s)
  });

  it("does not read while the tab is hidden and refreshes when the user returns", async () => {
    const refresh = vi.fn();
    renderHook(() => useVisiblePoll(refresh, 15_000));
    setVisibility("hidden");
    await advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips a return refresh within 5 seconds of the last read (rapid tab switching)", async () => {
    const refresh = vi.fn();
    renderHook(() => useVisiblePoll(refresh, 15_000));
    for (let i = 0; i < 5; i += 1) {
      setVisibility("hidden");
      await advance(500);
      setVisibility("visible");
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    await advance(5_000);
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("re-reads at once when the refresh changes (new urgent list) and stops on unmount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(({ refresh }) => useVisiblePoll(refresh, 15_000), { initialProps: { refresh: first } });
    view.rerender({ refresh: second });
    expect(second).toHaveBeenCalledTimes(1);
    await advance(15_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    view.unmount();
    await advance(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("does nothing until enabled (no user or role yet)", async () => {
    const refresh = vi.fn();
    renderHook(() => useVisiblePoll(refresh, 15_000, { enabled: false }));
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
  describe("Leads page full-list safety net (immediate: false, 60 s gap)", () => {
    const opts = { minGapMs: 60_000, immediate: false };

    it("does not read on mount (the page already loaded) and then reads every 60 s while visible", async () => {
      const refresh = vi.fn();
      renderHook(() => useVisiblePoll(refresh, 60_000, opts));
      expect(refresh).not.toHaveBeenCalled();
      await advance(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(60_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("skips the full reload when the user returns within 60 s of the last read", async () => {
      const refresh = vi.fn();
      renderHook(() => useVisiblePoll(refresh, 60_000, opts));
      for (let i = 0; i < 10; i += 1) { // e.g. flipping between the Quo and CRM tabs
        setVisibility("hidden");
        await advance(3_000);
        setVisibility("visible");
      }
      expect(refresh).not.toHaveBeenCalled(); // was 10 full-table reloads
    });

    it("still catches up on return after a longer absence, once", async () => {
      const refresh = vi.fn();
      renderHook(() => useVisiblePoll(refresh, 60_000, opts));
      setVisibility("hidden");
      await advance(5 * 60_000);
      expect(refresh).not.toHaveBeenCalled(); // no reads while hidden
      setVisibility("visible");
      expect(refresh).toHaveBeenCalledTimes(1);
      setVisibility("hidden");
      setVisibility("visible");
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("never runs when disabled (signed out)", async () => {
      const refresh = vi.fn();
      renderHook(() => useVisiblePoll(refresh, 60_000, { ...opts, enabled: false }));
      await advance(180_000);
      setVisibility("hidden");
      setVisibility("visible");
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
