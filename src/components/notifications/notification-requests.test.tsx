import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import type { NotificationChange } from "@/lib/realtime";
import NotificationBell from "./NotificationBell";
import UrgentLeadPopup from "./UrgentLeadPopup";
import JobInProgressPopup from "./JobInProgressPopup";
import QuoteUpdatedPopup from "./QuoteUpdatedPopup";
import IncompleteDetailsPopup from "./IncompleteDetailsPopup";
import { NotificationPopupProvider } from "./popup-slot";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrossTabProvider } from "@/hooks/useCrossTab";
import { createFakeTab, FakeChannelHub, FakeLocks } from "@/test/cross-tab-fakes";
import type { CrossTabCoordinator } from "@/lib/cross-tab";
import { RECONNECT_JITTER_MS, REALTIME_SAFETY_POLL_MS, reportRealtimeStatus, resetRealtimeHealth } from "@/lib/realtime-health";
import { OVERLOAD_BASE_COOLDOWN_MS, OVERLOAD_TRIP_COUNT, isBackgroundPollPaused, recordOverloadResponse, resetOverloadGuard } from "@/lib/overload-guard";

type Read = { table: string; columns: string; head: boolean; title: string; filters: Record<string, unknown>; limit?: number; since?: string; from?: string };
type Result = { data: unknown[] | null; count?: number; error?: { message: string } | null };
const state = vi.hoisted(() => ({
  user: { id: "synthetic-user" } as { id: string; created_at?: string },
  role: "admin" as AppRole,
  authenticated: true,
  reads: [] as Read[],
  writes: [] as Read[],
  channels: [] as { handlers: { event: string; callback: (payload: NotificationChange) => void }[] }[],
  respond: (read: Read): Promise<Result> => Promise.resolve({ data: [], count: read.head ? 0 : undefined }),
  remove: vi.fn(),
  urgentSound: vi.fn(),
  assignmentSound: vi.fn(),
  holdRefetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: state.user, role: state.role, fullyAuthenticated: state.authenticated,
}) }));
vi.mock("@/hooks/useOperatorWorkflow", () => ({ useHoldInbox: () => ({ data: { alerts: [], unread_count: 0 }, refetch: state.holdRefetch }) }));
vi.mock("@/lib/notification-sound", () => ({ playUrgentAlertSound: state.urgentSound, playAssignmentSound: state.assignmentSound }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const read: Read = { table, columns: "", head: false, title: "", filters: {} };
    let write = false;
    const finish = () => {
      if (write) { state.writes.push(read); return Promise.resolve({ data: [], error: null }); }
      state.reads.push(read);
      return state.respond(read);
    };
    const query = {
      select: (columns: string, options?: { head?: boolean }) => { read.columns = columns; read.head = Boolean(options?.head); return query; },
      eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      is: (key: string, value: null) => { read.filters[key] = value; return query; },
      or: (value: string) => { read.filters.or = value; return query; },
      ilike: (_key: string, value: string) => { read.title = value; return query; },
      gt: (_key: string, value: string) => { read.since = value; return query; },
      gte: (_key: string, value: string) => { read.from = value; return query; },
      order: () => query,
      limit: (value: number) => { read.limit = value; return query; },
      in: (key: string, value: string[]) => { read.filters[key] = value; return query; },
      update: () => { write = true; return query; },
      maybeSingle: () => finish().then((result) => ({ ...result, data: result.data?.[0] ?? null })),
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => finish().then(resolve, reject),
    };
    return query;
  },
  channel: () => {
    const handlers: typeof state.channels[number]["handlers"] = [];
    const channel = {
      on: (_type: string, filter: { event: string }, callback: (payload: NotificationChange) => void) => {
        handlers.push({ event: filter.event, callback }); return channel;
      },
      subscribe: () => channel,
    };
    state.channels.push({ handlers });
    return channel;
  },
  removeChannel: state.remove,
} }));

function mountAll() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationBell /><NotificationPopupProvider>
    <UrgentLeadPopup /><JobInProgressPopup /><QuoteUpdatedPopup /><IncompleteDetailsPopup />
  </NotificationPopupProvider></MemoryRouter></QueryClientProvider>);
}
function mountTab(coordinator: CrossTabCoordinator) {
  return render(<CrossTabProvider coordinator={coordinator}><QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <NotificationBell /><NotificationPopupProvider>
      <UrgentLeadPopup /><JobInProgressPopup /><QuoteUpdatedPopup /><IncompleteDetailsPopup />
    </NotificationPopupProvider>
  </MemoryRouter></QueryClientProvider></CrossTabProvider>);
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
function emit(title: string, eventType: "INSERT" | "UPDATE" = "INSERT") {
  const payload = { eventType, new: { title, user_id: state.user.id } } as NotificationChange;
  state.channels.at(-1)!.handlers.find((handler) => handler.event === eventType)!.callback(payload);
}
const KIND_BY_TITLE: Record<string, string> = {
  "Urgent Job": "urgent_job", "Job in Progress": "job_in_progress", "Quote Updated": "quote_updated", "Incomplete Details": "incomplete_details",
};
function notification(title: string, id = "synthetic-alert", createdAt = "2026-10-14T01:00:00Z") {
  return { id, user_id: state.user.id, title, kind: KIND_BY_TITLE[title] ?? null, message: 'Lead "Synthetic Customer" needs attention.',
    lead_id: "synthetic-lead", created_at: createdAt, read: false };
}
function notificationReads() { return state.reads.filter((read) => read.table === "notifications"); }
/** The pop-ups' shared read (selected by kind). */
function popupReads() { return notificationReads().filter((read) => Array.isArray(read.filters.kind)); }
function bellReads() { return notificationReads().filter((read) => !Array.isArray(read.filters.kind)); }
const kindsOf = (read: Read) => [...(read.filters.kind as string[])].sort();
/** Respond to the pop-up read with the given rows (only those of the requested kinds). */
function respondWith(rows: ReturnType<typeof notification>[], count = 0) {
  state.respond = (read) => Promise.resolve(Array.isArray(read.filters.kind)
    ? { data: rows.filter((row) => (read.filters.kind as string[]).includes(row.kind ?? "")) }
    : { data: [], count: read.head ? count : undefined });
}

beforeEach(() => {
  vi.useFakeTimers();
  state.user = { id: "synthetic-user" };
  state.role = "admin";
  state.authenticated = true;
  state.reads = [];
  state.writes = [];
  state.channels = [];
  state.respond = (read) => Promise.resolve({ data: [], count: read.head ? 0 : undefined });
  state.remove.mockClear();
  state.urgentSound.mockClear();
  state.assignmentSound.mockClear();
  sessionStorage.clear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); resetRealtimeHealth(); resetOverloadGuard(); });

describe("notification request optimization", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as AppRole[])(
    "%s reads only its own pop-up types, in one shared query, over one transport", async (role) => {
      state.role = role;
      const view = mountAll();
      await flush();
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      expect(state.channels).toHaveLength(1);
      const expected = ["urgent_job"];
      if (role === "admin" || role === "processor") expected.push("job_in_progress");
      if (role === "customer_service" || role === "cs_admin") expected.push("quote_updated", "incomplete_details");
      expect(popupReads()).toHaveLength(1);
      expect(kindsOf(popupReads()[0])).toEqual(expected.sort());
      expect(popupReads()[0].filters.read).toBe(false);
      expect(popupReads()[0].limit).toBe(100 * expected.length);
      expect(notificationReads().every((read) => read.filters.user_id === state.user.id)).toBe(true);
      expect(bellReads().filter((read) => !read.head).every((read) => read.limit === 20)).toBe(true);
      if (role === "opr") {
        expect(state.reads.some((read) => read.table === "lead_operator_assignments")).toBe(true);
        expect(bellReads().every((read) => read.filters.lead_id === null)).toBe(true);
      }
      view.unmount();
      expect(state.remove).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the 15-second bell and 20-second pop-up cadence, and pop-ups keep polling in a hidden tab", async () => {
    mountAll();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(bellReads()).toHaveLength(2);
    expect(popupReads()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(bellReads()).toHaveLength(4); // Bell list + exact count at 15s.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(popupReads()).toHaveLength(2); // All pop-up types in one read at 20s.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const bells = bellReads().length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(bellReads()).toHaveLength(bells);
    expect(popupReads()).toHaveLength(3);
  });

  it("polls rarely while realtime is healthy, returns to the fast cadence the moment it drops, and catches up once when it recovers", async () => {
    mountAll();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    const bells = bellReads().length; const popups = popupReads().length;
    // Realtime healthy: nothing in the first minute (was 4 bell + 3 pop-up reads).
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(bellReads()).toHaveLength(bells);
    expect(popupReads()).toHaveLength(popups);
    // ...but the safety net still runs (pop-up reads are batched 25 ms after the tick).
    await act(async () => { await vi.advanceTimersByTimeAsync(REALTIME_SAFETY_POLL_MS - 60_000 + 30); });
    expect(bellReads()).toHaveLength(bells + 2);
    expect(popupReads()).toHaveLength(popups + 1);
    // Realtime drops: back to every 15s / 20s immediately.
    act(() => { reportRealtimeStatus("global", "CHANNEL_ERROR"); });
    const droppedBells = bellReads().length; const droppedPopups = popupReads().length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_030); });
    expect(bellReads()).toHaveLength(droppedBells + 2);
    expect(popupReads()).toHaveLength(droppedPopups + 1);
    // Realtime recovers: one catch-up read for anything missed, then rare again.
    const beforeRecover = popupReads().length; const bellsBeforeRecover = bellReads().length;
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_JITTER_MS + 30); });
    expect(popupReads()).toHaveLength(beforeRecover + 1);
    expect(bellReads()).toHaveLength(bellsBeforeRecover + 2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(popupReads()).toHaveLength(beforeRecover + 1);
  });

  it("still shows an alert the moment realtime delivers it while polling is rare", async () => {
    mountAll();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    act(() => { reportRealtimeStatus("global", "SUBSCRIBED"); });
    respondWith([notification("Urgent Job")]);
    act(() => { emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/Synthetic Customer/)).toBeInTheDocument();
  });

  it("stops background polling while the server is overloaded, still shows realtime alerts at once, and resumes after the pause", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mountAll();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    // Resume exactly at the cooldown (no per-tab spread) so timings are exact.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    act(() => { for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse(); });
    random.mockRestore();
    const bells = bellReads().length; const popups = popupReads().length;
    // Without the guard this would be 2 bell + 1 pop-up reads every 15-20 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERLOAD_BASE_COOLDOWN_MS - 1_000); });
    expect(bellReads()).toHaveLength(bells);
    expect(popupReads()).toHaveLength(popups);
    // A realtime alert during the pause is still read and shown immediately.
    respondWith([notification("Urgent Job")]);
    act(() => { emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(popupReads()).toHaveLength(popups + 1);
    expect(screen.getByText(/Synthetic Customer/)).toBeInTheDocument();
    // After the pause, the normal 15 s / 20 s cadence returns within one interval.
    const bellsAtPause = bellReads().length;
    // Step past the end of the pause so React re-renders, then one full interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(isBackgroundPollPaused()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(bellReads().length).toBeGreaterThan(bellsAtPause);
    expect(popupReads().length).toBeGreaterThanOrEqual(popups + 2);
  });

  it("coalesces a 50-event burst into one read of only the affected pop-up type", async () => {
    mountAll();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    state.reads = [];
    await act(async () => { for (let i = 0; i < 50; i++) emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(bellReads()).toHaveLength(2); // One bell read/count pair, not 100.
    expect(popupReads()).toHaveLength(1);
    expect(kindsOf(popupReads()[0])).toEqual(["urgent_job"]);
  });

  it("catches events during a slow read with one trailing query and one sound", async () => {
    let resolve!: (result: Result) => void;
    state.respond = (read) => Array.isArray(read.filters.kind)
      ? new Promise<Result>((done) => { resolve = done; }) : Promise.resolve({ data: [], count: 0 });
    render(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    await act(async () => { for (let i = 0; i < 50; i++) emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(popupReads()).toHaveLength(1);
    respondWith([notification("Urgent Job")]);
    await act(async () => { resolve({ data: [] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(popupReads()).toHaveLength(2);
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    expect(state.urgentSound).toHaveBeenCalledTimes(1);
    await act(async () => { emit("Urgent Job", "UPDATE"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(state.urgentSound).toHaveBeenCalledTimes(1);
  });

  it("preserves popup priority, quote session cut-off, grouping and dismissal", async () => {
    state.role = "customer_service";
    sessionStorage.setItem("quote_updated_popup_baseline_at:synthetic-user", "2026-10-14T00:00:00Z");
    respondWith([
      notification("Urgent Job"), notification("Urgent Job", "duplicate-alert"),
      notification("Incomplete Details", "incomplete-a"), notification("Incomplete Details", "incomplete-b"),
      notification("Quote Updated", "quote-new"),
      notification("Quote Updated", "quote-before-session", "2026-10-13T23:00:00Z"),
    ], 250);
    mountAll();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("250");
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    expect(screen.queryByText("Quote Updated")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(state.writes[0].filters.id).toEqual(["synthetic-alert", "duplicate-alert"]);
    expect(screen.queryByText("Urgent Job")).not.toBeInTheDocument();
    expect(screen.queryByText("Quote Updated")).not.toBeInTheDocument(); // Incomplete details takes the next slot.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(screen.getByText("Quote Updated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    // Only the alert newer than this session's start was shown and dismissed.
    expect(state.writes.at(-1)!.filters.id).toEqual(["quote-new"]);
  });

  it("retains data on failed reads and recovers at the unchanged interval", async () => {
    respondWith([notification("Urgent Job")]);
    render(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    state.respond = () => Promise.resolve({ data: null, error: { message: "Denied" } });
    await act(async () => { emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    state.respond = () => Promise.resolve({ data: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.queryByText("Urgent Job")).not.toBeInTheDocument();
  });

  it("keeps exact unread counts independent of a failed list read", async () => {
    state.respond = (read) => Promise.resolve(read.head ? { data: null, count: 250 } : {
      data: null, error: { message: "Offline" },
    });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
    await flush();
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("250");
    state.respond = (read) => Promise.resolve(read.head ? { data: null, error: { message: "Offline" } } : {
      data: [notification("Recovered notification")],
    });
    await act(async () => { emit("Recovered notification", "UPDATE"); });
    await flush();
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("250");
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await flush();
    expect(screen.getByText("Recovered notification")).toBeInTheDocument();
  });

  it("keeps Operator assignment scope and verifies assignments before playing sound", async () => {
    state.role = "opr";
    state.respond = (read) => Promise.resolve({ data: read.table === "lead_operator_assignments" ?
      (read.filters.lead_id === "outside-scope" ? [] : [{ lead_id: "assigned-lead" }]) : [], count: 0 });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>);
    await flush();
    expect(notificationReads().every((read) => read.filters.or === "lead_id.is.null,lead_id.in.(assigned-lead)")).toBe(true);
    const send = (lead: string) => state.channels[0].handlers[0].callback({
      eventType: "INSERT", new: { title: "Lead Assigned", lead_id: lead },
    } as NotificationChange);
    await act(async () => { send("outside-scope"); });
    expect(state.assignmentSound).not.toHaveBeenCalled();
    await act(async () => { send("assigned-lead"); });
    expect(state.assignmentSound).toHaveBeenCalledOnce();
  });

  it("ignores an old user's delayed result and cancels queued work on unmount", async () => {
    let resolve!: (result: Result) => void;
    state.respond = () => new Promise<Result>((done) => { resolve = done; });
    const view = render(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    const oldResolve = resolve;
    await act(async () => { emit("Urgent Job"); });
    state.user = { id: "second-user" };
    state.respond = () => Promise.resolve({ data: [] });
    view.rerender(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    await act(async () => { oldResolve({ data: [notification("Urgent Job")] }); });
    await flush();
    expect(screen.queryByText("Urgent Job")).not.toBeInTheDocument();
    expect(state.urgentSound).not.toHaveBeenCalled();
    const reads = notificationReads().length;
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(notificationReads()).toHaveLength(reads);
    expect(state.remove).toHaveBeenCalledTimes(2);
  });
});

describe("several tabs of one browser", () => {
  const bellLists = () => bellReads().filter((read) => !read.head);

  it("polls once per browser, not once per tab, and every tab still shows the alert", async () => {
    const locks = new FakeLocks();
    const hub = new FakeChannelHub();
    const first = createFakeTab(locks, hub, true);
    const second = createFakeTab(locks, hub, false);
    mountTab(first.coordinator);
    await flush();
    mountTab(second.coordinator);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    state.reads = [];

    respondWith([notification("Urgent Job")]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    // One tab's cadence: pop-ups every 20s (one shared read), bell every 15s.
    expect(popupReads()).toHaveLength(3);
    expect(bellLists()).toHaveLength(4);
    expect(screen.getAllByText(/Synthetic Customer/)).toHaveLength(2);
  });

  it("hands polling to the remaining tab when the polling tab closes", async () => {
    const locks = new FakeLocks();
    const hub = new FakeChannelHub();
    const first = createFakeTab(locks, hub, true);
    const second = createFakeTab(locks, hub, false);
    const firstView = mountTab(first.coordinator);
    await flush();
    mountTab(second.coordinator);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    firstView.unmount();
    await flush();
    state.reads = [];

    // The remaining tab's 20-second tick plus the 25 ms pop-up batch window.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_100); });
    expect(popupReads()).toHaveLength(1);
    expect(bellLists()).toHaveLength(1);
  });

  it("answers another tab's refresh (its own realtime event or action) with one shared read", async () => {
    const locks = new FakeLocks();
    const hub = new FakeChannelHub();
    const first = createFakeTab(locks, hub, true);
    const second = createFakeTab(locks, hub, false);
    mountTab(first.coordinator);
    await flush();
    mountTab(second.coordinator);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    state.reads = [];
    respondWith([notification("Urgent Job")]);

    // Only the second tab's realtime transport delivers this event.
    await act(async () => { emit("Urgent Job"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(popupReads()).toHaveLength(1);
    expect(screen.getAllByText(/Synthetic Customer/)).toHaveLength(2);
  });
});

describe("how long notifications are shown", () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("bell, unread count and the pop-up read only the last 3 days", async () => {
    state.role = "cs_admin";
    const now = Date.now();
    mountAll();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    const reads = notificationReads();
    expect(reads.length).toBe(3);
    for (const read of reads) {
      expect(read.from, `${Array.isArray(read.filters.kind) ? "pop-ups" : read.head ? "bell count" : "bell list"} has a lower bound`).toBeDefined();
      expect(Math.abs(Date.parse(read.from!) - (now - 3 * DAY))).toBeLessThan(60_000);
    }
  });

  it("a new user sees nothing created before their account", async () => {
    const createdAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // joined 6 hours ago
    state.user = { id: "synthetic-user", created_at: createdAt };
    mountAll();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(notificationReads().length).toBe(3);
    expect(notificationReads().every((read) => read.from === createdAt)).toBe(true);
  });
});
