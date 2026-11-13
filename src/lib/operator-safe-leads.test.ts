import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as unknown, error: null as { message: string } | null }));
const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: state.data, error: state.error })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchOperatorSafeLeads } from "./operator-safe-leads";

describe("fetchOperatorSafeLeads", () => {
  it("calls the safe RPC, not a direct `leads` read", async () => {
    state.data = [{ id: "lead-1", customer_name: null }];
    state.error = null;
    const rows = await fetchOperatorSafeLeads();
    expect(rpc).toHaveBeenCalledWith("get_operator_safe_leads");
    expect(rows).toEqual([{ id: "lead-1", customer_name: null }]);
  });

  it("returns an empty array when the RPC has no rows yet", async () => {
    state.data = null;
    state.error = null;
    expect(await fetchOperatorSafeLeads()).toEqual([]);
  });

  it("throws on an RPC error instead of silently returning an empty list", async () => {
    state.data = null;
    state.error = { message: "denied" };
    await expect(fetchOperatorSafeLeads()).rejects.toMatchObject({ message: "denied" });
  });
});
