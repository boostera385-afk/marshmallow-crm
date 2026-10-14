import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const insert = vi.fn();
const getSession = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ insert: (...args: unknown[]) => insert(...args) }),
    auth: { getSession: () => getSession() },
  },
}));

const ACTOR = "actor-user";
const OTHER = "other-user";

async function deliver(userIds: string[]) {
  const { deliverLeadNotification } = await import("@/lib/lead-notifications");
  await deliverLeadNotification({
    leadId: "lead-1",
    title: "[Alert] Urgent Job",
    message: 'Lead "Jane" changed to Urgent Job',
    userIds,
  });
}

describe("deliverLeadNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: { user: { id: ACTOR } } } });
  });

  it("never notifies the person who triggered it", async () => {
    await deliver([ACTOR, OTHER]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_user_ids).toEqual([OTHER]);
  });

  it("sends nothing when the actor is the only recipient", async () => {
    await deliver([ACTOR]);

    expect(rpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("collapses duplicate recipients", async () => {
    await deliver([OTHER, OTHER, "third"]);

    expect(rpc.mock.calls[0][1].p_user_ids).toEqual([OTHER, "third"]);
  });

  it("falls back to a direct insert when the RPC is not deployed", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Could not find the function" } });

    await deliver([OTHER]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual([
      {
        user_id: OTHER,
        title: "[Alert] Urgent Job",
        message: 'Lead "Jane" changed to Urgent Job',
        lead_id: "lead-1",
        read: false,
      },
    ]);
  });

  it("does not fall back when the RPC fails for a real reason", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "permission denied" } });

    await expect(deliver([OTHER])).rejects.toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("urgent Customer Service ownership", () => {
  it("notifies the assigned CS instead of the previous creator", async () => {
    const { primaryCsNotificationRecipient } = await import("@/lib/lead-notifications");
    expect(primaryCsNotificationRecipient({ created_by: "old-cs", assigned_cs: "assigned-cs" })).toBe("assigned-cs");
  });

  it("falls back to the creator only while the lead is unassigned", async () => {
    const { primaryCsNotificationRecipient } = await import("@/lib/lead-notifications");
    expect(primaryCsNotificationRecipient({ created_by: "creator", assigned_cs: null })).toBe("creator");
  });
});
