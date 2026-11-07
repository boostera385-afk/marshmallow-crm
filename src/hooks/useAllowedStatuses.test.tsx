import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "cs_admin", grants: [] as Array<Record<string, unknown>>, visibility: [] as Array<Record<string, unknown>> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "17000000-0000-4000-8000-000000000002" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => ({
    select: () => table === "paid_lead_access"
      ? Promise.resolve({ data: state.grants, error: null })
      : { or: () => Promise.resolve({ data: state.visibility, error: null }) },
  }) },
}));
import { useAllowedStatuses } from "./useAllowedStatuses";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const leads = [
  { id: "a", status: "paid", created_at: "2026-10-15T16:00:00Z" },
  { id: "b", status: "paid", created_at: "2026-11-15T16:00:00Z" },
  { id: "c", status: "urgent_job", created_at: "2026-11-15T16:00:00Z" },
];
afterEach(() => { state.grants = []; state.visibility = []; state.role = "cs_admin"; });

it("shows paid leads in the user's range only once Paid is granted", async () => {
  state.visibility = [{ user_id: "17000000-0000-4000-8000-000000000002", status: "paid", is_visible: true }];
  state.grants = [{ user_id: "17000000-0000-4000-8000-000000000002", start_date: "2026-10-01", end_date: "2026-10-31" }];
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual(["a", "c"]));
});

it("shows every paid lead for an all-time grant", async () => {
  state.visibility = [{ user_id: "17000000-0000-4000-8000-000000000002", status: "paid", is_visible: true }];
  state.grants = [{ user_id: "17000000-0000-4000-8000-000000000002", start_date: null, end_date: null }];
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual(["a", "b", "c"]));
});

it("hides paid leads when Paid is not granted", async () => {
  const { result } = renderHook(() => useAllowedStatuses(), { wrapper });
  await waitFor(() => expect(result.current.filterLeads(leads).map((l) => l.id)).toEqual(["c"]));
});
