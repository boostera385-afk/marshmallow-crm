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
  it("accepts the Waiting for CX schedule-confirmation hold reason", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      observed_at: "2026-10-14T00:00:00Z", unread_count: 1,
      alerts: [{
        id: "00000000-0000-4000-8000-000000000001",
        lead_id: "00000000-0000-4000-8000-000000000002",
        revision: "00000000-0000-4000-8000-000000000003",
        reason: "waiting_schedule_confirmation",
        snapshot: {
          job_id: "MM-123", customer_name: "Customer", customer_phone: null, customer_landline: null,
          service_type: null, service_details: null, address: null, city: null, state: null, zip_code: null,
          customer_schedule_requirements: null, scheduled_date: null, scheduled_time_start: null,
          scheduled_time_end: null, tech_name: null, tech_number: null, status: "urgent_job",
          cs_tag: "waiting_schedule_confirmation", quote: null,
        },
        read: false, created_at: "2026-10-14T00:00:00Z",
      }],
    }, error: null });
    await expect(fetchHoldInbox()).resolves.toMatchObject({ alerts: [{ reason: "waiting_schedule_confirmation" }] });
  });
});
