import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeHoldAlert, acknowledgeHoldInbox, fetchHoldInbox, fetchLeadCopyAccess, resolveLeadCopyAccess, setLeadCopyPermission } from "./operator-workflow";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => mocks.rpc.mockReset());

describe("copy access precedence", () => {
  it.each(["opr", "opr_admin"] as const)("enables %s by default", (role) => {
    expect(resolveLeadCopyAccess(role)).toBe(true);
    expect(resolveLeadCopyAccess(role, false)).toBe(false);
    expect(resolveLeadCopyAccess(role, false, true)).toBe(true);
    expect(resolveLeadCopyAccess(role, true, false)).toBe(false);
    expect(resolveLeadCopyAccess(role, false, null)).toBe(false);
  });
  it("retains Admin access and denies anonymous access", () => {
    expect(resolveLeadCopyAccess("admin", false, false)).toBe(true);
    expect(resolveLeadCopyAccess(null)).toBe(false);
  });
});

describe("authenticated workflow RPC boundary", () => {
  it("does not substitute default allow when the permission migration is missing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing" } });
    await expect(fetchLeadCopyAccess()).rejects.toThrow("Apply the Copy Details");
  });
  it("rejects malformed permission responses", async () => {
    mocks.rpc.mockResolvedValue({ data: "true", error: null });
    await expect(fetchLeadCopyAccess()).rejects.toThrow();
  });
  it("resets user overrides through the admin RPC, not profile writes", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await setLeadCopyPermission(null, "user-1", null);
    expect(mocks.rpc).toHaveBeenCalledWith("set_lead_copy_permission", { p_role: null, p_user_id: "user-1", p_allowed: null });
  });
  it("preserves the revision to avoid acknowledging a newer event", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    expect(await acknowledgeHoldAlert({ id: "alert-1", revision: "revision-1" })).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("acknowledge_operator_hold_alert", { p_id: "alert-1", p_revision: "revision-1", p_alerts: null });
  });
  it("marks only the displayed revisions read, not unseen concurrent commits", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    await acknowledgeHoldInbox([{ id: "alert-1", revision: "revision-1" }]);
    expect(mocks.rpc).toHaveBeenCalledWith("acknowledge_operator_hold_alert", { p_id: null, p_revision: null, p_alerts: [{ id: "alert-1", revision: "revision-1" }] });
  });
  it("rejects untrusted malformed notification payloads", async () => {
    mocks.rpc.mockResolvedValue({ data: { alerts: [{ reason: "any_status" }] }, error: null });
    await expect(fetchHoldInbox()).rejects.toThrow();
  });
});
