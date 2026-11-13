import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeadsPage from "./LeadsPage";
import { LEADS_DELTA_LIMIT, LEADS_FULL_RECONCILE_MS, LEADS_VISIBILITY_CHECK_MS, resetLeadsSyncState } from "@/lib/leads-sync";
import { OVERLOAD_BASE_COOLDOWN_MS, OVERLOAD_TRIP_COUNT, recordOverloadResponse, resetOverloadGuard, setServerLoadLevel } from "@/lib/overload-guard";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToLeadChanges } from "@/lib/realtime";
import type { ComponentProps } from "react";
import type LeadCard from "@/components/leads/LeadCard";

/**
 * Request behaviour of the Leads page against a recording Supabase fake.
 * A "full" read is the paged whole-table read (uses .range); a "delta" read
 * asks only for leads with updated_at past the cursor (uses .gt("updated_at")).
 */
type Call = { method: string; args: unknown[] };
type Read = { table: string; calls: Call[] };
type Response = { data: Record<string, unknown>[] | null; error: { message: string; code?: string } | null; count?: number };
type PendingMetadata = { read: Read; resolve: (value: Response) => void; reject: (reason: Error) => void };

const state = vi.hoisted(() => ({
  role: "admin" as string,
  reads: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
  cache: null as null | { leads: Record<string, unknown>[]; savedAt: number | null },
  cacheWrites: [] as { key: string; count: number; savedAt: number | undefined }[],
  totalLeads: 2500,
  deltaRows: [] as Record<string, unknown>[],
  deltaError: null as null | { message: string },
  visibleIds: null as null | string[],
  idError: null as null | { message: string },
  toastError: vi.fn(),
  holdMetadata: false,
  pendingMetadata: [] as PendingMetadata[],
  metadataRows: {} as Record<string, Record<string, unknown>[]>,
  metadataErrors: {} as Record<string, { message: string; code?: string }>,
}));

const has = (read: Read, method: string, first?: unknown) =>
  read.calls.some((call) => call.method === method && (first === undefined || call.args[0] === first));
const isLeadsIndexRead = (read: Read) => read.table === "leads" && read.calls.some((c) => c.method === "select" && String(c.args[0]).includes("customer_schedule_requirements"));
const fullReads = () => state.reads.filter((r) => isLeadsIndexRead(r) && has(r, "range"));
const deltaReads = () => state.reads.filter((r) => isLeadsIndexRead(r) && has(r, "gt", "updated_at"));
const isIdRead = (read: Read) => read.table === "leads" && read.calls.some((c) => c.method === "select" && c.args[0] === "id");
const idReads = () => state.reads.filter(isIdRead);
const isMetadataRead = (read: Read) => ["lead_notes", "lead_photos", "lead_cancellation_requests", "lead_quote_approval_requests"].includes(read.table) && has(read, "in", "lead_id");
const metadataReads = () => state.reads.filter(isMetadataRead);
const fallbackReads = () => state.reads.filter((read) => ["lead_notes", "lead_photos", "lead_cancellation_requests"].includes(read.table) && has(read, "eq", "lead_id"));
const metadataResponse = (read: Read): Response => {
  const ids = read.calls.find((call) => call.method === "in" && call.args[0] === "lead_id")!.args[1] as string[];
  return { data: (state.metadataRows[read.table] ?? []).filter((row) => ids.includes(String(row.lead_id))), error: state.metadataErrors[read.table] ?? null };
};

function respond(read: Read) {
  if (isMetadataRead(read)) {
    if (state.holdMetadata) return new Promise<Response>((resolve, reject) => { state.pendingMetadata.push({ read, resolve, reject }); });
    return Promise.resolve(metadataResponse(read));
  }
  if (isIdRead(read)) {
    if (state.idError) return Promise.resolve({ data: null, error: state.idError });
    const [from, to] = read.calls.find((c) => c.method === "range")!.args as [number, number];
    const ids = state.visibleIds ?? Array.from({ length: state.totalLeads }, (_, i) => `lead-${i}`);
    return Promise.resolve({ data: ids.slice(from, to + 1).map((id) => ({ id })), error: null });
  }
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
  // Card hydration: the full row for each lead on screen.
  const byIds = read.calls.find((c) => c.method === "in" && c.args[0] === "id");
  if (read.table === "leads" && byIds) {
    return Promise.resolve({ data: (byIds.args[1] as string[]).map((id) => ({ id, status: "new", created_at: "2026-11-01T00:00:00.000Z" })), error: null });
  }
  // A plain Operator's RESTRICTIVE policy denies direct `leads` reads — every
  // read above is unreachable for that role in the real app. This simulates
  // the server-side safe projection (get_operator_safe_leads()) it uses instead.
  if (read.table === "rpc:get_operator_safe_leads") {
    // "new" here (not the real RPC's actual "urgent_job") only to avoid
    // exercising the unrelated nearby-urgent proximity path in this test file.
    const data = Array.from({ length: state.totalLeads }, (_, i) => ({
      id: `lead-${i}`, status: "new", cs_tag: null,
      created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-09T12:00:00.000Z",
    }));
    return Promise.resolve({ data, error: null });
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
      rpc: (fn: string) => builder(`rpc:${fn}`),
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
vi.mock("@/lib/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/realtime")>();
  return { ...actual, subscribeToLeadChanges: vi.fn(actual.subscribeToLeadChanges) };
});
vi.mock("sonner", () => ({ toast: { error: state.toastError, success: vi.fn(), info: vi.fn() } }));
// Record the card's existing fallback contract: without page metadata it starts
// notes, an exact photo count, photo paths, and a pending cancellation on mount.
vi.mock("@/components/leads/LeadCard", () => ({ default: function Card({ lead, initialHasNotes, initialPhotoCount, initialPhotoPaths, initialPendingCancellationRequest, pendingQuoteApproval }: ComponentProps<typeof LeadCard>) {
  useEffect(() => {
    if (initialHasNotes === undefined) void Promise.resolve(supabase.from("lead_notes").select("note_type").eq("lead_id", lead.id));
    if (initialPhotoCount === undefined) void Promise.resolve(supabase.from("lead_photos").select("id", { count: "exact", head: true }).eq("lead_id", lead.id));
    if (initialPhotoPaths === undefined) void Promise.resolve(supabase.from("lead_photos").select("photo_url").eq("lead_id", lead.id).order("created_at", { ascending: true }));
    if (initialPendingCancellationRequest === undefined) void Promise.resolve(supabase.from("lead_cancellation_requests").select("*").eq("lead_id", lead.id).eq("status", "pending"));
  }, [lead.id, initialHasNotes, initialPhotoCount, initialPhotoPaths, initialPendingCancellationRequest]);
  return <div data-testid="lead-card" data-photo-count={initialPhotoCount} data-has-notes={initialHasNotes?.general} data-pending-quote={pendingQuoteApproval}>{lead.id}</div>;
} }));
vi.mock("@/components/leads/OprLeadCard", () => ({ default: () => null }));
vi.mock("@/components/leads/LeadTable", () => ({ default: () => <div data-testid="lead-table" /> }));
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
  state.visibleIds = null;
  state.idError = null;
  state.toastError.mockReset();
  state.holdMetadata = false;
  state.pendingMetadata = [];
  state.metadataRows = {};
  state.metadataErrors = {};
  vi.mocked(subscribeToLeadChanges).mockClear();
  localStorage.removeItem("leadsViewMode");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); resetOverloadGuard(); });

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

describe("Leads page metadata batching", () => {
  const releaseMetadata = async (pending = state.pendingMetadata.splice(0)) => {
    await act(async () => {
      pending.forEach(({ read, resolve }) => resolve(metadataResponse(read)));
      await vi.advanceTimersByTimeAsync(10);
    });
  };

  it.each(["admin", "customer_service", "opr"])("waits for the batch instead of issuing per-card reads for %s", async (role) => {
    state.role = role;
    state.totalLeads = 20;
    state.holdMetadata = true;
    state.metadataRows = {
      lead_notes: [{ lead_id: "lead-0", note_type: "general" }],
      lead_photos: [{ lead_id: "lead-0", photo_url: "synthetic/photo.jpg", created_at: "2026-11-01T00:00:00Z" }],
    };
    await mount();
    expect(metadataReads()).toHaveLength(5);
    expect(screen.queryAllByTestId("lead-card")).toHaveLength(0);
    expect(fallbackReads()).toHaveLength(0);

    await releaseMetadata();
    const cards = screen.getAllByTestId("lead-card");
    expect(cards).toHaveLength(20);
    const first = cards.find((card) => card.textContent === "lead-0")!;
    expect(first).toHaveAttribute("data-photo-count", "1");
    expect(first).toHaveAttribute("data-has-notes", "true");
    expect(metadataReads()).toHaveLength(5);
    expect(fallbackReads()).toHaveLength(0);
  });

  it("keeps card fallback available when a required batch read is denied", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    state.totalLeads = 2;
    state.metadataErrors.lead_photos = { code: "42501", message: "permission denied" };
    await mount();
    expect(screen.getAllByTestId("lead-card")).toHaveLength(2);
    expect(fallbackReads()).toHaveLength(8);
    expect(error).toHaveBeenCalledWith("Failed to load paged metadata", state.metadataErrors.lead_photos);
    error.mockRestore();
  });

  it("does not fall back or block cards when only quote-approval metadata is denied", async () => {
    state.totalLeads = 2;
    state.metadataErrors.lead_quote_approval_requests = { code: "42501", message: "permission denied" };
    await mount();
    expect(screen.getAllByTestId("lead-card")).toHaveLength(2);
    expect(screen.getAllByTestId("lead-card").every((card) => card.dataset.pendingQuote === "false")).toBe(true);
    expect(fallbackReads()).toHaveLength(0);
  });

  it("allows card fallback after a network rejection instead of leaving a loading skeleton", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    state.totalLeads = 2;
    state.holdMetadata = true;
    await mount();
    const pending = state.pendingMetadata.splice(0);
    await act(async () => {
      pending[0].reject(new Error("network unavailable"));
      pending.slice(1).forEach(({ read, resolve }) => resolve(metadataResponse(read)));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getAllByTestId("lead-card")).toHaveLength(2);
    expect(fallbackReads()).toHaveLength(8);
    error.mockRestore();
  });

  it("does not wait for card-only metadata in table view", async () => {
    localStorage.setItem("leadsViewMode", "table");
    state.totalLeads = 2;
    state.holdMetadata = true;
    await mount();
    expect(screen.getByTestId("lead-table")).toBeInTheDocument();
    expect(fallbackReads()).toHaveLength(0);
    await releaseMetadata();
  });

  it("ignores a retired page's batch failure and recovers on the current page", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    state.totalLeads = 40;
    state.holdMetadata = true;
    await mount();
    const retired = state.pendingMetadata.splice(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await vi.advanceTimersByTimeAsync(10);
    });
    const current = state.pendingMetadata.splice(0);
    expect(current).toHaveLength(5);
    const ids = current[0].read.calls.find((call) => call.method === "in")!.args[1] as string[];
    await act(async () => {
      retired[0].reject(new Error("retired request failed"));
      retired.slice(1).forEach(({ read, resolve }) => resolve(metadataResponse(read)));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryAllByTestId("lead-card")).toHaveLength(0);
    expect(fallbackReads()).toHaveLength(0);
    await releaseMetadata(current);
    expect(screen.getAllByTestId("lead-card").map((card) => card.textContent).sort()).toEqual([...ids].sort());
    expect(fallbackReads()).toHaveLength(0);
    error.mockRestore();
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

  it("skips timed refreshes while the server is overloaded but still refreshes when the user returns to the tab", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.cache = freshCache();
    await mount();
    state.reads = [];
    for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse();
    await advance(OVERLOAD_BASE_COOLDOWN_MS - 1_000);
    expect(deltaReads()).toHaveLength(0);
    // A user action: coming back to the tab.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(10); });
    expect(deltaReads()).toHaveLength(1);
    // After the pause the timed refresh resumes.
    await advance(60_000);
    expect(deltaReads()).toHaveLength(2);
  });

  it("keeps reading only changes, and postpones the 30-minute complete reload, while the server reports elevated load", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    for (let minute = 0; minute < 35; minute++) {
      setServerLoadLevel("elevated"); // the governor re-announces every minute
      await advance(60_000);
    }
    expect(fullReads()).toHaveLength(0);
    expect(deltaReads().length).toBeGreaterThanOrEqual(34);
  });
});

describe("Leads page: leads that leave the user's view", () => {
  const shownIds = () => Array.from(document.querySelectorAll('[data-testid="lead-card"]')).map((n) => n.textContent);

  it("removes a lead the user can no longer see within 3 minutes, using an id-only read", async () => {
    state.cache = freshCache();
    await mount();
    expect(shownIds().sort()).toEqual(["lead-1", "lead-2"]);
    state.visibleIds = ["lead-1"]; // e.g. lead-2 was marked Paid and left a CS Admin's view
    state.reads = [];
    await advance(LEADS_VISIBILITY_CHECK_MS);
    expect(idReads()).toHaveLength(1);
    expect(idReads()[0].calls.find((c) => c.method === "select")!.args[0]).toBe("id"); // no customer data
    expect(fullReads()).toHaveLength(0);
    expect(shownIds()).toEqual(["lead-1"]);
  });

  it("costs one id read every 3 minutes, and none while the tab is hidden", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    await advance(9 * 60_000);
    expect(idReads()).toHaveLength(3 * 3); // 3 checks x 3 pages of ids for 2,500 leads
    expect(fullReads()).toHaveLength(0);
    state.reads = [];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await advance(9 * 60_000);
    expect(idReads()).toHaveLength(0);
  });

  it("removes nothing when the id read fails, and retries at the next check", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.cache = freshCache();
    await mount();
    state.visibleIds = ["lead-1"];
    state.idError = { message: "upstream timeout" };
    await advance(LEADS_VISIBILITY_CHECK_MS);
    expect(shownIds().sort()).toEqual(["lead-1", "lead-2"]);
    expect(state.toastError).not.toHaveBeenCalled();
    state.idError = null;
    await advance(LEADS_VISIBILITY_CHECK_MS);
    expect(shownIds()).toEqual(["lead-1"]);
    warn.mockRestore();
  });

  it("keeps CS users' id check scoped to their own leads", async () => {
    state.role = "customer_service";
    state.cache = freshCache();
    await mount();
    await advance(LEADS_VISIBILITY_CHECK_MS);
    expect(idReads().length).toBeGreaterThan(0);
    expect(idReads().every((r) => r.calls.some((c) => c.method === "eq" && c.args[0] === "created_by" && c.args[1] === "user-1"))).toBe(true);
  });

  it("skips the id check while the server reports raised load", async () => {
    state.cache = freshCache();
    await mount();
    state.reads = [];
    for (let minute = 0; minute < 6; minute++) {
      setServerLoadLevel("elevated");
      await advance(60_000);
    }
    expect(idReads()).toHaveLength(0);
    expect(deltaReads().length).toBeGreaterThanOrEqual(5);
  });
});

describe("Leads page: plain Operator safe reads", () => {
  const rpcReads = () => state.reads.filter((r) => r.table === "rpc:get_operator_safe_leads");

  it("loads through the safe RPC instead of any direct `leads` read, for opr", async () => {
    state.role = "opr";
    state.totalLeads = 3;
    await mount();
    expect(rpcReads()).toHaveLength(1);
    expect(fullReads()).toHaveLength(0);
    expect(deltaReads()).toHaveLength(0);
    expect(screen.queryAllByTestId("lead-card")).toHaveLength(3); // rendered straight from the RPC rows, no second hydration read
    expect(state.cacheWrites).toEqual([{ key: "opr:user-1", count: 3, savedAt: Date.now() - 10 }]);
  });

  it("does not open the realtime `leads` channel for opr", async () => {
    state.role = "opr";
    await mount();
    expect(subscribeToLeadChanges).not.toHaveBeenCalled();
  });

  it("opens the realtime `leads` channel for every other role", async () => {
    state.role = "admin";
    await mount();
    expect(subscribeToLeadChanges).toHaveBeenCalledTimes(1);
  });

  it("re-polls the safe RPC every ~15s for opr, not the 60s shared with every other role", async () => {
    state.role = "opr";
    state.totalLeads = 1;
    await mount();
    state.reads = [];
    await advance(15_000);
    expect(rpcReads().length).toBeGreaterThanOrEqual(1);
  });

  it("does not re-poll a non-Operator role at 15s (60s cadence instead)", async () => {
    state.role = "admin";
    state.cache = freshCache();
    await mount();
    state.reads = [];
    await advance(15_000);
    expect(deltaReads()).toHaveLength(0);
    expect(fullReads()).toHaveLength(0);
  });
});
