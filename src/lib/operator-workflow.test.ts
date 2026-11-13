import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeAllHoldAlerts, acknowledgeHoldAlert, acknowledgeHoldInbox, fetchHoldInbox, fetchLeadCopyAccess, resolveLeadCopyAccess, setLeadCopyPermission, type HoldInbox } from "./operator-workflow";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
beforeEach(() => { mocks.rpc.mockReset(); mocks.from.mockReset(); });

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

describe("one-click complete hold acknowledgement", () => {
  const inbox: HoldInbox = { observed_at: "2026-11-13T07:00:00Z", unread_count: 0, alerts: [] };
  const revision = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, revision: "00000000-0000-4000-8000-000000000999" });
  const mockPages = (pages: { data: unknown; error: { message: string } | null }[]) => {
    const reads: Record<string, unknown>[] = [];
    mocks.from.mockImplementation(() => {
      const read: Record<string, unknown> = {};
      reads.push(read);
      const query = {
        select: (value: string) => { read.select = value; return query; },
        eq: (key: string, value: unknown) => { read[key] = value; return query; },
        lte: (key: string, value: unknown) => { read[key] = value; return query; },
        gt: (key: string, value: unknown) => { read[`after_${key}`] = value; return query; },
        order: (key: string) => { read.order = key; return query; },
        limit: (value: number) => { read.limit = value; return query; },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(pages.shift()).then(resolve, reject),
      };
      return query;
    });
    return reads;
  };

  it("does no read or write for an empty inbox", async () => {
    expect(await acknowledgeAllHoldAlerts("user-1", inbox)).toEqual({ requested: 0, applied: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reuses loaded revisions for the common case, with one batch write", async () => {
    const alerts = [{ ...revision(1), read: false }, { ...revision(2), read: true }] as HoldInbox["alerts"];
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    expect(await acknowledgeAllHoldAlerts("user-1", { ...inbox, unread_count: 1, alerts })).toEqual({ requested: 1, applied: 1 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("acknowledge_operator_hold_alert", { p_id: null, p_revision: null, p_alerts: [revision(1)] });
  });

  it("covers more than 100 cards and 1000 rows without reading any snapshots or writing per alert", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => revision(index + 1));
    const second = [revision(1001), revision(1002)];
    const reads = mockPages([{ data: first, error: null }, { data: second, error: null }]);
    mocks.rpc.mockResolvedValue({ data: 1002, error: null });
    expect(await acknowledgeAllHoldAlerts("user-1", { ...inbox, unread_count: 1002 })).toEqual({ requested: 1002, applied: 1002 });
    expect(reads).toEqual([
      { select: "id, revision", user_id: "user-1", read: false, created_at: inbox.observed_at, order: "id", limit: 1000 },
      { select: "id, revision", user_id: "user-1", read: false, created_at: inbox.observed_at, order: "id", limit: 1000, after_id: first[999].id },
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1].p_alerts).toEqual([...first, ...second]);
  });

  it("makes no acknowledgement write if the complete snapshot read fails", async () => {
    mockPages([{ data: null, error: { message: "Read denied" } }]);
    await expect(acknowledgeAllHoldAlerts("user-1", { ...inbox, unread_count: 101 })).rejects.toThrow("Read denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
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
