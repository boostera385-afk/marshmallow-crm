import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeadsPage from "./LeadsPage";
import { LEADS_DELTA_LIMIT, LEADS_FULL_RECONCILE_MS, resetLeadsSyncState } from "@/lib/leads-sync";

/**
 * Request behaviour of the Leads page against a recording Supabase fake.
 * A "full" read is the paged whole-table read (uses .range); a "delta" read
 * asks only for leads with updated_at past the cursor (uses .gt("updated_at")).
 */
type Call = { method: string; args: unknown[] };
type Read = { table: string; calls: Call[] };

const state = vi.hoisted(() => ({
  role: "admin" as string,
  reads: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
  cache: null as null | { leads: Record<string, unknown>[]; savedAt: number | null },
  cacheWrites: [] as { key: string; count: number; savedAt: number | undefined }[],
  totalLeads: 2500,
  deltaRows: [] as Record<string, unknown>[],
  deltaError: null as null | { message: string },
  toastError: vi.fn(),
}));

const has = (read: Read, method: string, first?: unknown) =>
  read.calls.some((call) => call.method === method && (first === undefined || call.args[0] === first));
const isLeadsIndexRead = (read: Read) => read.table === "leads" && read.calls.some((c) => c.method === "select" && String(c.args[0]).includes("customer_schedule_requirements"));
const fullReads = () => state.reads.filter((r) => isLeadsIndexRead(r) && has(r, "range"));
const deltaReads = () => state.reads.filter((r) => isLeadsIndexRead(r) && has(r, "gt", "updated_at"));

function respond(read: Read) {
  if (isLeadsIndexRead(read) && has(read, "range")) {
    const range = read.calls.find((c) => c.method === "range")!.args as [number, number];
    const [from, to] = range;
    const count = Math.max(0, Math.min(state.totalLeads, to + 1) - from);
    const data = Array.from({ length: count }, (_, i) => ({
      id: `lead-${from + i}`, status: "new", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-09T12:00:00.000Z",
    }));
    return Promise.resolve({ data, error: null });
  }
  if (isLeadsIndexRead(read) && has(read, "gt", "updated_at")) {
    return Promise.resolve(state.deltaError ? { data: null, error: state.deltaError } : { data: state.deltaRows, error: null });
  }
  return Promise.resolve({ data: [], error: null, count: 0 });
}

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const read: Read = { table, calls: [] };
    state.reads.push(read);
    const proxy: unknown = new Proxy(function noop() {}, {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => respond(read).then(resolve, reject);
        return (...args: unknown[]) => { read.calls.push({ method: String(prop), args }); return proxy; };
      },
    });
    return proxy;
  };
  const channel = () => {
    const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => Promise.resolve() };
    return ch;
  };
  return {
    supabase: {
      from: builder,
      rpc: () => builder("rpc"),
      channel,
      removeChannel: () => Promise.resolve(),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => {
  const user = { id: "user-1", created_at: "2026-01-01T00:00:00Z" };
  const profile = { full_name: "Synthetic" };
  return { useAuth: () => ({ user, role: state.role, profile }) };
});
vi.mock("@/contexts/NotepadContext", () => {
  const value = { toggleNotepad: () => {}, isNotepadOpen: false, activeUserIds: [] };
  return { useNotepad: () => value };
});
vi.mock("@/hooks/useAllowedStatuses", () => {
  // Stable identities, like the real hook's memoized values.
  const value = { filterLeads: <T,>(rows: T[]) => rows, allowedStatuses: new Set(["new"]) };
  return { useAllowedStatuses: () => value };
});
vi.mock("@/lib/leadsCache", () => ({
  readLeadsCacheEntry: async () => state.cache,
  writeLeadsCache: async (key: string, leads: unknown[], savedAt?: number) => { state.cacheWrites.push({ key, count: leads.length, savedAt }); },
}));
vi.mock("@/lib/zipCentroids", () => ({ preloadZipDataset: () => Promise.resolve() }));
vi.mock("sonner", () => ({ toast: { error: state.toastError, success: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/leads/LeadCard", () => ({ default: () => null }));
vi.mock("@/components/leads/OprLeadCard", () => ({ default: () => null }));
vi.mock("@/components/leads/LeadTable", () => ({ default: () => null }));
vi.mock("@/components/leads/AddLeadDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/UrgentAICheckDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/LeadReportDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/ExportLeadsDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/InstallExtensionDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/ScheduleDateFilter", () => ({ ScheduleDateFilter: () => null }));

const mount = async () => {
  render(<MemoryRouter><LeadsPage /></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  resetLeadsSyncState();
  state.role = "admin";
  state.reads = [];
  state.cache = null;
  state.cacheWrites = [];
  state.totalLeads = 2500;
  state.deltaRows = [];
  state.deltaError = null;
  state.toastError.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const freshCache = (savedAgoMs = 60_000) => ({
  leads: [
    { id: "lead-1", status: "new", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-10T11:58:00.000Z" },
    { id: "lead-2", status: "new", created_at: "2026-11-02T00:00:00.000Z", updated_at: "2026-11-10T11:30:00.000Z" },
  ],
  savedAt: Date.now() - savedAgoMs,
});

describe("Leads page loading", () => {
  it("does one complete paged read on a first visit and caches it with its load time", async () => {
    await mount();
    expect(fullReads()).toHaveLength(3); // 1,000 + 1,000 + 500 rows
    expect(deltaReads()).toHaveLength(0);
    expect(state.cacheWrites).toEqual([{ key: "admin:user-1", count: 2500, savedAt: Date.now() - 10 }]);
  });

  it("paints from a recent cache and reads only what changed since it, not every lead", async () => {
    state.cache = freshCache();
    await mount();
    expect(fullReads()).toHaveLength(0);
    expect(deltaReads()).toHaveLength(1);
    const since = deltaReads()[0].calls.find((c) => c.method === "gt")!.args[1];
    // Newest cached change (11:58) minus the 2-minute overlap.
    expect(since).toBe("2026-11-10T11:56:00.000Z");
    expect(has(deltaReads()[0], "limit", LEADS_DELTA_LIMIT)).toBe(true);
  });

  it("reloads everything when the cache is older than the reconcile window", async () => {
    state.cache = freshCache(LEADS_FULL_RECONCILE_MS + 1);
    await mount();
    expect(fullReads().length).toBeGreaterThan(0);
    expect(deltaReads()).toHaveLength(0);
  });

  it("reloads everything when the cache predates the cursor column", async () => {
    state.cache = { leads: [{ id: "lead-1", status: "new", created_at: "2026-11-01T00:00:00.000Z" }], savedAt: Date.now() };
    await mount();
    expect(fullReads().length).toBeGreaterThan(0);
    expect(deltaReads()).toHaveLength(0);
  });

  it("keeps CS users scoped to their own leads in the delta read", async () => {
    state.role = "customer_service";
    state.cache = freshCache();
    await mount();
    expect(deltaReads()).toHaveLength(1);
    expect(has(deltaReads()[0], "eq", "created_by")).toBe(true);
    expect(deltaReads()[0].calls.find((c) => c.method === "eq" && c.args[0] === "created_by")!.args[1]).toBe("user-1");
  });
});

describe("Leads page background refresh", () => {
  it("makes 10 small delta reads and no complete read over 10 visible minutes", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    await advance(10 * 60_000);
    // Before this change: 10 complete reads of every lead (6 pages each at 5,450 leads).
    expect(fullReads()).toHaveLength(0);
    expect(deltaReads()).toHaveLength(10);
  });

  it("still reconciles with one complete read once the window has passed", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    await advance(LEADS_FULL_RECONCILE_MS);
    expect(fullReads().length).toBeGreaterThan(0);
    const fullPagesAfterReconcile = fullReads().length;
    await advance(5 * 60_000);
    expect(fullReads()).toHaveLength(fullPagesAfterReconcile);
  });

  it("does not read while the tab is hidden", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await advance(5 * 60_000);
    expect(deltaReads()).toHaveLength(0);
    expect(fullReads()).toHaveLength(0);
  });

  it("falls back to a complete read when too much changed at once", async () => {
    state.cache = freshCache();
    state.deltaRows = Array.from({ length: LEADS_DELTA_LIMIT }, (_, i) => ({ id: `changed-${i}`, status: "new", created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T11:59:00Z" }));
    await mount();
    expect(deltaReads()).toHaveLength(1);
    expect(fullReads().length).toBeGreaterThan(0);
  });

  it("keeps the list and shows no error when a background delta fails, then retries", async () => {
    state.cache = freshCache();
    state.deltaError = { message: "upstream timeout" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount();
    expect(state.toastError).not.toHaveBeenCalledWith("Failed to load leads");
    expect(fullReads()).toHaveLength(0);
    state.deltaError = null;
    await advance(60_000);
    expect(deltaReads()).toHaveLength(2);
    warn.mockRestore();
  });

  it("advances the cursor after changes arrive", async () => {
    state.cache = freshCache();
    state.deltaRows = [{ id: "lead-1", status: "quoted", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-10T11:59:30.000Z" }];
    await mount();
    state.deltaRows = [];
    await advance(60_000);
    const since = deltaReads()[1].calls.find((c) => c.method === "gt")!.args[1];
    expect(since).toBe("2026-11-10T11:57:30.000Z");
  });
});
