import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_ROW_UPDATED_MESSAGE, updateLeadById } from "./lead-updates";
const mocks = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: mocks.update }) } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockResolvedValue({ error: null, count: 1 });
});
describe("acknowledged lead updates", () => {
  it("requests the affected-row count, cleans values and acknowledges exactly one row", async () => {
    await expect(updateLeadById("lead-1", { status: "scheduled", amount: NaN, quote: undefined })).resolves.toEqual({ id: "lead-1" });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ status: "scheduled", amount: null }, { count: "exact" });
    expect(mocks.eq).toHaveBeenCalledWith("id", "lead-1");
  });
  it.each([0, null, undefined, 2])("does not call an unconfirmed %s-row write successful", async (count) => {
    mocks.eq.mockResolvedValue({ error: null, count });
    await expect(updateLeadById("lead-1", {})).rejects.toThrow(NO_ROW_UPDATED_MESSAGE);
  });
  it("preserves backend failure and refuses a missing lead ID", async () => {
    mocks.eq.mockResolvedValue({ error: { message: "Permission denied" }, count: null });
    await expect(updateLeadById("lead-1", {})).rejects.toThrow("Permission denied");
    mocks.update.mockClear();
    await expect(updateLeadById("", {})).rejects.toThrow("Missing lead ID");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
