import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "cs_admin",
  grants: [] as Array<Record<string, unknown>>,
  visibility: [] as Array<Record<string, unknown>>,
  paidIds: { data: [] as string[] | null, error: null as Error | null },
  rpcCalls: [] as string[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "17000000-0000-4000-8000-000000000002" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => { state.rpcCalls.push(name); return Promise.resolve(state.paidIds); },
    from: (table: string) => ({
    select: () => table === "paid_lead_access"
      ? Promise.resolve({ data: state.grants, error: null })
      : { or: () => Promise.resolve({ data: state.visibility, error: null }) },
  }) },
}));
import { useAllowedStatuses } from "./useAllowedStatuses";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
// a: created in October, paid in November. b: created in November, paid in October.
const A = "17100000-0000-4000-8000-00000000000a";
const B = "17100000-0000-4000-8000-00000000000b";
const C = "17100000-0000-4000-8000-00000000000c";
const leads = [
  { id: A, status: "paid", created_at: "2026-10-15T16:00:00Z" },
  { id: B, status: "paid", created_at: "2026-11-15T16:00:00Z" },
  { id: C, status: "urgent_job", created_at: "2026-11-15T16:00:00Z" },
];
afterEach(() => {
  state.grants = []; state.visibility = []; state.role = "cs_admin";
  state.paidIds = { data: [], error: null }; state.rpcCalls = [];
});
const grantOctober = () => {
  state.visibility = [{ user_id: "17000000-0000-4000-8000-000000000002", status: "paid", is_visible: true }];
  state.grants = [{ user_id: "17000000-0000-4000-8000-000000000002", start_date: "2026-10-01", end_date: "2026-10-31" }];
};

it("shows paid leads that became paid in the range, whatever their created date", async () => {
  grantOctober();
  state.paidIds = { data: [B], error: null }; // the database: only B became paid in October
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual([B, C]));
  expect(state.rpcCalls).toEqual(["my_paid_lead_ids"]);
});

it("hides ranged paid leads when the database cannot say which are in range", async () => {
  grantOctober();
  state.paidIds = { data: null, error: new Error("function my_paid_lead_ids() does not exist") };
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(state.rpcCalls).toEqual(["my_paid_lead_ids"]));
  expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual([C]);
});

it("shows every paid lead for an all-time grant", async () => {
  state.visibility = [{ user_id: "17000000-0000-4000-8000-000000000002", status: "paid", is_visible: true }];
  state.grants = [{ user_id: "17000000-0000-4000-8000-000000000002", start_date: null, end_date: null }];
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual([A, B, C]));
  expect(state.rpcCalls).toEqual([]); // all time needs no id list
});

it("hides paid leads when Paid is not granted", async () => {
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual([C]));
});
