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

type Read = { table: string; columns: string; head: boolean; title: string; filters: Record<string, unknown>; limit?: number; since?: string };
type Result = { data: unknown[] | null; count?: number; error?: { message: string } | null };
const state = vi.hoisted(() => ({
  user: { id: "synthetic-user" },
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
  return render(<MemoryRouter><NotificationBell /><NotificationPopupProvider>
    <UrgentLeadPopup /><JobInProgressPopup /><QuoteUpdatedPopup /><IncompleteDetailsPopup />
  </NotificationPopupProvider></MemoryRouter>);
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
function emit(title: string, eventType: "INSERT" | "UPDATE" = "INSERT") {
  const payload = { eventType, new: { title, user_id: state.user.id } } as NotificationChange;
  state.channels.at(-1)!.handlers.find((handler) => handler.event === eventType)!.callback(payload);
}
function notification(title: string, id = "synthetic-alert") {
  return { id, user_id: state.user.id, title, message: 'Lead "Synthetic Customer" needs attention.',
    lead_id: "synthetic-lead", created_at: "2026-10-14T01:00:00Z", read: false };
}
function notificationReads() { return state.reads.filter((read) => read.table === "notifications"); }

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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("notification request optimization", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as AppRole[])(
    "%s keeps its eligible queries but shares one transport", async (role) => {
      state.role = role;
      const view = mountAll();
      await flush();
      expect(state.channels).toHaveLength(1);
      const popupTitles = notificationReads().filter((read) => read.title).map((read) => read.title);
      const expected = ["%Urgent Job%"];
      if (role === "admin" || role === "processor") expected.push("%Job in Progress%");
      if (role === "customer_service" || role === "cs_admin") expected.push("%Quote Updated%", "%Incomplete Details%");
      expect(popupTitles.sort()).toEqual(expected.sort());
      expect(notificationReads().every((read) => read.filters.user_id === state.user.id)).toBe(true);
      expect(notificationReads().filter((read) => !read.title && !read.head).every((read) => read.limit === 20)).toBe(true);
      expect(notificationReads().filter((read) => read.title).every((read) => read.limit === 100 && read.filters.read === false)).toBe(true);
      if (role === "opr") {
        expect(state.reads.some((read) => read.table === "lead_operator_assignments")).toBe(true);
        expect(notificationReads().filter((read) => !read.title).every((read) => read.filters.lead_id === null)).toBe(true);
      }
      view.unmount();
      expect(state.remove).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the 15/20/25-second fallback intervals and hidden-tab popup polling", async () => {
    mountAll();
    await flush();
    expect(notificationReads()).toHaveLength(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(notificationReads()).toHaveLength(6); // Bell list + exact count at 15s.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(notificationReads().filter((read) => read.title === "%Urgent Job%")).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(notificationReads().filter((read) => read.title === "%Job in Progress%")).toHaveLength(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const bells = notificationReads().filter((read) => !read.title).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(notificationReads().filter((read) => !read.title)).toHaveLength(bells);
    expect(notificationReads().filter((read) => read.title === "%Urgent Job%")).toHaveLength(3);
    expect(notificationReads().filter((read) => read.title === "%Job in Progress%")).toHaveLength(3);
  });

  it("coalesces a 50-event burst without fetching unrelated popup types", async () => {
    mountAll();
    await flush();
    state.reads = [];
    await act(async () => { for (let i = 0; i < 50; i++) emit("Urgent Job"); });
    expect(notificationReads()).toHaveLength(3); // One bell read/count pair + one urgent read, not 150.
    expect(notificationReads().filter((read) => read.title === "%Job in Progress%")).toHaveLength(0);
  });

  it("catches events during a slow read with one trailing query and one sound", async () => {
    let resolve!: (result: Result) => void;
    state.respond = (read) => read.title === "%Urgent Job%"
      ? new Promise<Result>((done) => { resolve = done; }) : Promise.resolve({ data: [], count: 0 });
    render(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await flush();
    await act(async () => { for (let i = 0; i < 50; i++) emit("Urgent Job"); });
    expect(notificationReads()).toHaveLength(1);
    state.respond = () => Promise.resolve({ data: [notification("Urgent Job")] });
    await act(async () => { resolve({ data: [] }); });
    await flush();
    expect(notificationReads()).toHaveLength(2);
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    expect(state.urgentSound).toHaveBeenCalledTimes(1);
    await act(async () => { emit("Urgent Job", "UPDATE"); });
    await flush();
    expect(state.urgentSound).toHaveBeenCalledTimes(1);
  });

  it("preserves popup priority, quote baseline, grouping and dismissal", async () => {
    state.role = "customer_service";
    sessionStorage.setItem("quote_updated_popup_baseline_at:synthetic-user", "2026-10-14T00:00:00Z");
    state.respond = (read) => Promise.resolve({ data: read.title ? [
      notification(read.title.replace(/%/g, "")), notification(read.title.replace(/%/g, ""), "duplicate-alert"),
    ] : [], count: read.head ? 250 : undefined });
    mountAll();
    await flush();
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("250");
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    expect(screen.queryByText("Quote Updated")).not.toBeInTheDocument();
    expect(notificationReads().find((read) => read.title === "%Quote Updated%")?.since).toBe("2026-10-14T00:00:00Z");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(state.writes[0].filters.id).toEqual(["synthetic-alert", "duplicate-alert"]);
    expect(screen.queryByText("Urgent Job")).not.toBeInTheDocument();
    expect(screen.queryByText("Quote Updated")).not.toBeInTheDocument(); // Incomplete details takes the next slot.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(screen.getByText("Quote Updated")).toBeInTheDocument();
  });

  it("retains data on failed reads and recovers at the unchanged interval", async () => {
    state.respond = () => Promise.resolve({ data: [notification("Urgent Job")] });
    render(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await flush();
    state.respond = () => Promise.resolve({ data: null, error: { message: "Denied" } });
    await act(async () => { emit("Urgent Job"); });
    expect(screen.getByText("Urgent Job")).toBeInTheDocument();
    state.respond = () => Promise.resolve({ data: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.queryByText("Urgent Job")).not.toBeInTheDocument();
  });

  it("keeps exact unread counts independent of a failed list read", async () => {
    state.respond = (read) => Promise.resolve(read.head ? { data: null, count: 250 } : {
      data: null, error: { message: "Offline" },
    });
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
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
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
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
    await flush();
    const oldResolve = resolve;
    await act(async () => { emit("Urgent Job"); });
    state.user = { id: "second-user" };
    state.respond = () => Promise.resolve({ data: [] });
    view.rerender(<MemoryRouter><UrgentLeadPopup /></MemoryRouter>);
    await flush();
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
