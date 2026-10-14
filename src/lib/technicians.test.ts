import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTechniciansPage } from "./technicians";
const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), eq: vi.fn(), not: vi.fn(), select: vi.fn(), order: vi.fn(), range: vi.fn(), or: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: state }));
beforeEach(() => {
  vi.resetAllMocks();
  const query = { eq: state.eq, not: state.not, select: state.select, order: state.order, range: state.range, or: state.or };
  state.from.mockReturnValue(query);
  for (const fn of [state.eq, state.not, state.select, state.order, state.or]) fn.mockReturnValue(query);
  state.range.mockResolvedValue({ data: [], count: 0, error: null });
});
describe("Copilot technician deep link", () => {
  it("filters by saved ID and preserves own-code scope rather than using broad search RPC", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    await expect(fetchTechniciansPage({ page: 1, pageSize: 10, search: "Alice", technicianId: id, visibility: { mode: "own", oprCode: "OPR1" } })).resolves.toEqual({ technicians: [], totalCount: 0 });
    expect(state.eq).toHaveBeenCalledWith("id", id);
    expect(state.eq).toHaveBeenCalledWith("opr_code", "OPR1");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("returns no records when an OPR has no code, even with a selected ID", async () => {
    expect(await fetchTechniciansPage({ page: 1, pageSize: 10, search: "", technicianId: "synthetic", visibility: { mode: "own" } })).toEqual({ technicians: [], totalCount: 0 });
    expect(state.from).not.toHaveBeenCalled();
  });
  it("does not hide a failed backend lookup", async () => {
    state.range.mockResolvedValue({ data: null, error: { message: "Permission denied" } });
    await expect(fetchTechniciansPage({ page: 1, pageSize: 10, search: "", technicianId: "synthetic" })).rejects.toMatchObject({ message: "Permission denied" });
  });
});
