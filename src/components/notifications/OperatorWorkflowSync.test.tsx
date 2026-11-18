import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeBus } from "@/lib/realtime";
import { RECONNECT_JITTER_MS, REALTIME_SAFETY_POLL_MS, reportRealtimeStatus, resetRealtimeHealth } from "@/lib/realtime-health";
import { resetOverloadGuard } from "@/lib/overload-guard";
import OperatorWorkflowSync, { COPY_ACCESS_POLL_MS } from "./OperatorWorkflowSync";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "test-user" }, role: "opr" }) }));
const relay = vi.hoisted(() => ({ tables: [] as string[], released: [] as string[] }));
vi.mock("@/lib/realtime", () => ({
  realtimeBus: new EventTarget(),
  relayTableToBus: (table: string) => {
    relay.tables.push(table);
    return () => relay.released.push(table);
  },
}));

beforeEach(() => {
  relay.tables = [];
  relay.released = [];
  act(() => {
    resetRealtimeHealth();
    resetOverloadGuard();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSync() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(<QueryClientProvider client={client}><OperatorWorkflowSync /></QueryClientProvider>);
  return { client, invalidate, ...view };
}

describe("shared workflow refresh", () => {
  it("invalidates refreshed rows, polls for missed events, and cleans up on unmount", () => {
    vi.useFakeTimers();
    const { client, invalidate, unmount } = renderSync();
    act(() => realtimeBus.dispatchEvent(new Event("lead_hold_alerts")));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    invalidate.mockClear();
    act(() => vi.advanceTimersByTime(20000));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    unmount();
    invalidate.mockClear();
    act(() => {
      realtimeBus.dispatchEvent(new Event("lead_hold_alerts"));
      vi.advanceTimersByTime(40000);
    });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it("uses the slow safety-net cadence while realtime is healthy", () => {
    vi.useFakeTimers();
    act(() => reportRealtimeStatus("test-health", "SUBSCRIBED"));
    const { client, invalidate } = renderSync();

    act(() => vi.advanceTimersByTime(20_000));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(REALTIME_SAFETY_POLL_MS - 20_000));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    client.clear();
  });

  it("catches up once after realtime reconnects", () => {
    vi.useFakeTimers();
    act(() => reportRealtimeStatus("test-health", "CHANNEL_ERROR"));
    const { client, invalidate } = renderSync();
    invalidate.mockClear();

    act(() => reportRealtimeStatus("test-health", "SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(RECONNECT_JITTER_MS + 1));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-access", "test-user", "opr"] }, { cancelRefetch: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-settings"] }, { cancelRefetch: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    client.clear();
  });

  it("subscribes to hold alerts only while mounted and never to the copy-permission tables", () => {
    const { client, unmount } = renderSync();
    expect(relay.tables).toEqual(["lead_hold_alerts"]);
    unmount();
    expect(relay.released).toEqual(["lead_hold_alerts"]);
    client.clear();
  });

  it("re-reads copy access every 30 s while visible, even when realtime is healthy", () => {
    vi.useFakeTimers();
    act(() => reportRealtimeStatus("test-health", "SUBSCRIBED"));
    const { client, invalidate } = renderSync();
    act(() => vi.advanceTimersByTime(COPY_ACCESS_POLL_MS - 1));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-access", "test-user", "opr"] }, { cancelRefetch: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-settings"] }, { cancelRefetch: false });
    // Hold alerts stay on their realtime-backed safety-net cadence.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    client.clear();
  });

  it("does not poll copy access from a hidden tab; it re-reads when the tab becomes visible", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { client, invalidate } = renderSync();
    act(() => vi.advanceTimersByTime(COPY_ACCESS_POLL_MS * 2));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["lead-copy-access", "test-user", "opr"] }, { cancelRefetch: false });
    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-access", "test-user", "opr"] }, { cancelRefetch: false });
    visibility.mockRestore();
    client.clear();
  });
});
