import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrossTabCoordinator } from "@/lib/cross-tab";
import { CrossTabProvider, useCrossTabQuerySync, useSharedQuery } from "@/hooks/useCrossTab";
import { createFakeTab, FakeChannelHub, FakeLocks } from "@/test/cross-tab-fakes";
import { RECONNECT_JITTER_MS, REALTIME_SAFETY_POLL_MS, reportRealtimeStatus, resetRealtimeHealth } from "@/lib/realtime-health";
import { OVERLOAD_BASE_COOLDOWN_MS, OVERLOAD_TRIP_COUNT, recordOverloadResponse, resetOverloadGuard } from "@/lib/overload-guard";

function Badge({ read, enabled = true }: { read: () => Promise<number>; enabled?: boolean }) {
  useCrossTabQuerySync();
  const { data } = useSharedQuery({
    queryKey: ["pending-count", "user-1"],
    queryFn: read,
    enabled,
    sharedPoll: { intervalMs: 15_000 },
  });
  return <span data-testid="badge">{data ?? "-"}</span>;
}

function mount(coordinator: CrossTabCoordinator, read: () => Promise<number>) {
  return render(
    <CrossTabProvider coordinator={coordinator}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Badge read={read} />
      </QueryClientProvider>
    </CrossTabProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("useSharedQuery across tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("polls from one tab and keeps the other tab's badge current without its own reads", async () => {
    const locks = new FakeLocks();
    const hub = new FakeChannelHub();
    let count = 0;
    const firstRead = vi.fn(async () => ++count);
    const secondRead = vi.fn(async () => -1);
    mount(createFakeTab(locks, hub, true).coordinator, firstRead);
    await advance(10);
    mount(createFakeTab(locks, hub, false).coordinator, secondRead);
    await advance(10);

    await advance(60_000);
    // Initial read + one per 15 seconds, plus the second tab's mount served by the owner.
    expect(firstRead.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(firstRead.mock.calls.length).toBeLessThanOrEqual(6);
    expect(secondRead).not.toHaveBeenCalled();
    const [first, second] = screen.getAllByTestId("badge").map((badge) => badge.textContent);
    expect(second).toBe(first);
    expect(first).toBe(String(count));
  });

  it("keeps independent per-tab polling when the browser cannot coordinate", async () => {
    const { createCrossTabCoordinator } = await import("@/lib/cross-tab");
    const firstRead = vi.fn(async () => 1);
    const secondRead = vi.fn(async () => 2);
    mount(createCrossTabCoordinator({ locks: null }), firstRead);
    mount(createCrossTabCoordinator({ locks: null }), secondRead);
    await advance(30_000);
    expect(firstRead).toHaveBeenCalledTimes(3);
    expect(secondRead).toHaveBeenCalledTimes(3);
  });

  it("does not read or poll for a disabled badge", async () => {
    const locks = new FakeLocks();
    const read = vi.fn(async () => 1);
    render(
      <CrossTabProvider coordinator={createFakeTab(locks, new FakeChannelHub(), true).coordinator}>
        <QueryClientProvider client={new QueryClient()}><Badge read={read} enabled={false} /></QueryClientProvider>
      </CrossTabProvider>,
    );
    await advance(60_000);
    expect(read).not.toHaveBeenCalled();
  });
});

function RealtimeBadge({ read, realtimeBacked }: { read: () => Promise<number>; realtimeBacked: boolean }) {
  const { data } = useSharedQuery({
    queryKey: ["realtime-count", "user-1", realtimeBacked],
    queryFn: read,
    sharedPoll: { intervalMs: 15_000, realtimeBacked },
  });
  return <span data-testid="badge">{data ?? "-"}</span>;
}

describe("realtime-backed shared polls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); resetRealtimeHealth(); });

  const mountRealtime = (read: () => Promise<number>, realtimeBacked: boolean) => {
    const hub = new FakeChannelHub(); const locks = new FakeLocks();
    return render(
      <CrossTabProvider coordinator={createFakeTab(locks, hub, true).coordinator}>
        {/* Same defaults as the app's QueryClient (src/App.tsx). */}
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })}>
          <RealtimeBadge read={read} realtimeBacked={realtimeBacked} />
        </QueryClientProvider>
      </CrossTabProvider>,
    );
  };

  it("polls rarely while realtime is healthy, fast when it is not, and once on recovery", async () => {
    const read = vi.fn(async () => 1);
    mountRealtime(read, true);
    await advance(10);
    expect(read).toHaveBeenCalledTimes(1);
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(REALTIME_SAFETY_POLL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    act(() => { reportRealtimeStatus("global", "CHANNEL_ERROR"); });
    await advance(15_000);
    expect(read).toHaveBeenCalledTimes(3);
    await advance(15_000);
    expect(read).toHaveBeenCalledTimes(4);
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    await advance(RECONNECT_JITTER_MS);
    expect(read).toHaveBeenCalledTimes(5); // one catch-up read on reconnect, spread over a few seconds
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("leaves polls without a realtime source at their normal interval", async () => {
    const read = vi.fn(async () => 1);
    mountRealtime(read, false);
    await advance(10);
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("waits out an overload pause instead of polling into it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const read = vi.fn(async () => 1);
    mountRealtime(read, false);
    await advance(10);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    act(() => { for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse(); });
    // Nothing during the 30 s pause (it would have polled twice)...
    await advance(OVERLOAD_BASE_COOLDOWN_MS);
    expect(read).toHaveBeenCalledTimes(2);
    // ...then the normal 15 s cadence restarts from the end of the pause.
    await advance(15_000);
    expect(read).toHaveBeenCalledTimes(3);
    resetOverloadGuard();
  });
});
