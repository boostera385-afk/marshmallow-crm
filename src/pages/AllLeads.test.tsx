import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AllLeads from "./AllLeads";
import {
  OVERLOAD_BASE_COOLDOWN_MS,
  OVERLOAD_RESUME_JITTER_MS,
  OVERLOAD_TRIP_COUNT,
  recordOverloadResponse,
  resetOverloadGuard,
} from "@/lib/overload-guard";

/**
 * Request behaviour of the All Leads page against a recording Supabase fake.
 * The page pages the whole table once a minute as a realtime safety net; these
 * tests pin that the poll uses the narrow index projection, skips its turn
 * while the overload guard is paused, and that lead changes arrive through the
 * shared realtime bus (one `leads` channel per tab) without extra reads.
 */
type Call = { method: string; args: unknown[] };
type Read = { table: string; calls: Call[] };

const state = vi.hoisted(() => ({
  reads: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
  rows: [] as Record<string, unknown>[],
  leadChangeHandlers: [] as ((payload: unknown) => void)[],
}));

const leadReads = () => state.reads.filter((r) => r.table === "leads");
const selectArg = (read: Read) => String(read.calls.find((c) => c.method === "select")?.args[0] ?? "");

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const read: Read = { table, calls: [] };
    state.reads.push(read);
    const proxy: unknown = new Proxy(function noop() {}, {
      get(_target, prop) {
        if (prop === "then")
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
            const range = read.calls.find((c) => c.method === "range")?.args as [number, number] | undefined;
            const data = range ? state.rows.slice(range[0], range[1] + 1) : state.rows;
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          };
        return (...args: unknown[]) => { read.calls.push({ method: String(prop), args }); return proxy; };
      },
    });
    return proxy;
  };
  const channel = (name: string) => {
    const ch = {
      on: (kind: string, filter: { table?: string }, handler: (payload: unknown) => void) => {
        if (kind === "postgres_changes" && filter.table === "leads") state.leadChangeHandlers.push(handler);
        return ch;
      },
      subscribe: () => ch,
      unsubscribe: () => Promise.resolve(),
      topic: name,
    };
    return ch;
  };
  return {
    supabase: {
      from: builder,
      channel,
      removeChannel: () => Promise.resolve(),
    },
  };
});
vi.mock("@/contexts/AuthContext", () => {
  const user = { id: "user-1", created_at: "2026-01-01T00:00:00Z" };
  return { useAuth: () => ({ user, role: "admin", profile: { full_name: "Synthetic" } }) };
});
vi.mock("@/contexts/NotepadContext", () => {
  const value = { toggleNotepad: () => {}, isNotepadOpen: false, activeUserIds: [] };
  return { useNotepad: () => value };
});
vi.mock("@/hooks/useAllowedStatuses", () => {
  const value = { filterLeads: <T,>(rows: T[]) => rows, allowedStatuses: new Set(["new"]) };
  return { useAllowedStatuses: () => value };
});
vi.mock("@/components/leads/AddLeadDialog", () => ({ default: () => null }));
vi.mock("@/components/leads/LeadDetailPanel", () => ({ default: () => null }));
vi.mock("@/components/leads/LeadCoverageBadge", () => ({ default: () => null }));
vi.mock("@/components/leads/UrgentAICheckDialog", () => ({ default: () => null }));

const row = (id: string, name: string) => ({
  id,
  job_id: `J-${id}`,
  customer_name: name,
  customer_phone: "555-0100",
  address: "1 Main St",
  status: "new",
  service_type: "repair",
  created_at: "2026-11-01T00:00:00.000Z",
  last_edited_at: null,
  cs_tag: null,
  created_by: "user-1",
  quote_requested_by: null,
  urgent_at: null,
  coverage_level: null,
  coverage_tech_count: null,
  coverage_area_label: null,
});

let client: QueryClient;
const mount = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AllLeads />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  state.reads = [];
  state.rows = [row("lead-0", "Original Customer")];
  state.leadChangeHandlers = [];
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); resetOverloadGuard(); });

describe("All Leads requests", () => {
  it("reads the table with the index projection, never every column", async () => {
    await mount();
    expect(leadReads().length).toBeGreaterThan(0);
    for (const read of leadReads()) {
      expect(selectArg(read)).not.toBe("*");
      // The sort and realtime merge both need these; the detail view loads the
      // heavy columns itself.
      expect(selectArg(read)).toContain("cs_tag");
      expect(selectArg(read)).not.toContain("service_details");
    }
    expect(screen.getByText("Original Customer")).toBeTruthy();
  });

  it("runs the 60s safety poll, pauses it while the server is overloaded, and resumes after", async () => {
    await mount();
    state.reads = [];
    await advance(2 * 60_000);
    expect(leadReads()).toHaveLength(2);

    // Four overload responses inside the window trip the guard: no polls land
    // while the cooldown runs (the next read is the deliberate refresh when the
    // pause lifts).
    for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse();
    await advance(10); // let the pause propagate to the hook
    state.reads = [];
    await advance(OVERLOAD_BASE_COOLDOWN_MS - 5_000);
    expect(leadReads()).toHaveLength(0);

    // After the cooldown (plus resume jitter) the poll comes back on its own.
    await advance(OVERLOAD_BASE_COOLDOWN_MS + OVERLOAD_RESUME_JITTER_MS);
    state.reads = [];
    await advance(2 * 60_000);
    expect(leadReads().length).toBeGreaterThan(0);
  });

  it("applies a lead change from the shared realtime bus without a new read", async () => {
    await mount();
    expect(state.leadChangeHandlers).toHaveLength(1); // one shared leads channel, not a page-private one
    state.reads = [];

    await act(async () => {
      state.leadChangeHandlers[0]({
        eventType: "UPDATE",
        new: { ...row("lead-0", "Renamed Customer") },
        old: { id: "lead-0" },
      });
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.getByText("Renamed Customer")).toBeTruthy();
    expect(screen.queryByText("Original Customer")).toBeNull();
    expect(leadReads()).toHaveLength(0);
  });
});
