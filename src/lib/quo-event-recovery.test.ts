import { describe, expect, it } from "vitest";
import {
  RECOVERY_NOTE,
  recoverStuckEvent,
  recoveryOrder,
  type ConversationRow,
  type RecoveryStore,
  type StuckEvent,
} from "../../supabase/functions/_shared/quo-event-recovery";

/** In-memory stand-in for the tables recovery touches. Synthetic data only. */
function memoryStore(seed: { conversations?: (ConversationRow & { quo_conversation_id: string; status?: string; customer_name?: string })[]; messages?: { quo_message_id: string; conversation_id: string; text?: string }[]; leads?: { id: string; customer_phone: string }[]; failOn?: string } = {}) {
  const conversations = new Map((seed.conversations ?? []).map((c) => [c.quo_conversation_id, { ...c } as Record<string, unknown>]));
  const messages = new Map((seed.messages ?? []).map((m) => [m.quo_message_id, { ...m } as Record<string, unknown>]));
  const events = new Map<string, { status: string; note: string }>();
  const flags = new Set<string>();
  const phones = new Map<string, string>();
  const writes: string[] = [];
  let n = 0;
  const fail = (what: string) => { if (seed.failOn === what) throw new Error(`${what} unavailable`); };
  const store: RecoveryStore = {
    async findConversationIdByMessage(id) { return (messages.get(id)?.conversation_id as string) ?? null; },
    async findLeadIdByPhone(phone) { return seed.leads?.find((l) => l.customer_phone === phone)?.id ?? null; },
    async getConversation(qid) {
      const c = conversations.get(qid);
      return c ? { id: c.id as string, linked_lead_id: (c.linked_lead_id as string) ?? null, last_message_at: (c.last_message_at as string) ?? null } : null;
    },
    async messageExists(id) { return messages.has(id); },
    async upsertPhoneNumber(row) { writes.push("phone"); const id = phones.get(row.quo_phone_number_id as string) ?? `phone-${++n}`; phones.set(row.quo_phone_number_id as string, id); return id; },
    async insertConversation(row) {
      fail("conversation"); writes.push("conversation:insert");
      const created = { ...row, id: `conv-${++n}` }; conversations.set(row.quo_conversation_id as string, created);
      return { id: created.id, linked_lead_id: (row.linked_lead_id as string) ?? null, last_message_at: (row.last_message_at as string) ?? null };
    },
    async updateConversation(id, patch) {
      writes.push("conversation:update");
      for (const c of conversations.values()) if (c.id === id) Object.assign(c, patch);
    },
    async upsertMessage(row) { fail("message"); writes.push("message"); messages.set(row.quo_message_id as string, { ...(messages.get(row.quo_message_id as string) ?? {}), ...row }); return "m"; },
    async ensureFlags(id) { writes.push("flags"); flags.add(id); },
    async markEvent(id, status, note) { writes.push(`event:${status}`); events.set(id, { status, note }); },
  };
  return { store, conversations, messages, events, flags, writes };
}

const received = (over: Record<string, unknown> = {}): StuckEvent => ({
  id: "event-1",
  event_type: "message.received",
  raw_payload: {
    id: "EV1", type: "message.received",
    data: { object: { object: "message", id: "AC-1", conversationId: "CN-1", phoneNumberId: "PN-1", direction: "incoming",
      from: "+15550100001", to: ["+15550100999"], text: "Can you come Friday?", createdAt: "2026-11-09T20:05:00.000Z", ...over } },
  },
});

describe("recovering a stuck Quo event", () => {
  it("creates the missing conversation and message, links the lead, and marks the event processed", async () => {
    const m = memoryStore({ leads: [{ id: "lead-1", customer_phone: "+15550100001" }] });
    const out = await recoverStuckEvent(m.store, received(), false);
    expect(out).toEqual({ result: "recovered", messageExisted: false, conversationCreated: true });
    const conv = m.conversations.get("CN-1")!;
    expect(conv).toMatchObject({ linked_lead_id: "lead-1", status: "active", last_customer_message_at: "2026-11-09T20:05:00.000Z", last_message_preview: "Can you come Friday?" });
    expect(m.messages.get("AC-1")).toMatchObject({ conversation_id: conv.id, sender: "customer", direction: "inbound", text: "Can you come Friday?" });
    expect(m.flags.has(conv.id as string)).toBe(true);
    expect(m.events.get("event-1")).toEqual({ status: "processed", note: RECOVERY_NOTE });
  });

  it("adds an old message to an existing conversation without reopening, renaming or relinking it", async () => {
    const m = memoryStore({ conversations: [{ id: "conv-9", quo_conversation_id: "CN-1", linked_lead_id: "lead-7", last_message_at: "2026-11-10T07:00:00.000Z", status: "closed", customer_name: "Kept Name" }] });
    await recoverStuckEvent(m.store, received(), false);
    const conv = m.conversations.get("CN-1")!;
    expect(conv).toMatchObject({ status: "closed", customer_name: "Kept Name", linked_lead_id: "lead-7", last_message_at: "2026-11-10T07:00:00.000Z" });
    expect(m.writes).not.toContain("conversation:update");
    expect(m.messages.get("AC-1")).toMatchObject({ conversation_id: "conv-9" });
  });

  it("moves only the last-message fields when the recovered message is the newest", async () => {
    const m = memoryStore({ conversations: [{ id: "conv-9", quo_conversation_id: "CN-1", linked_lead_id: null, last_message_at: "2026-11-09T19:00:00.000Z", status: "closed" }] });
    await recoverStuckEvent(m.store, received(), false);
    expect(m.conversations.get("CN-1")).toMatchObject({ status: "closed", last_message_at: "2026-11-09T20:05:00.000Z", last_customer_message_at: "2026-11-09T20:05:00.000Z" });
  });

  it("never duplicates a message that was already saved; it is upserted on its Quo id", async () => {
    const m = memoryStore({ conversations: [{ id: "conv-9", quo_conversation_id: "CN-1", linked_lead_id: null, last_message_at: null }], messages: [{ quo_message_id: "AC-1", conversation_id: "conv-9" }] });
    const out = await recoverStuckEvent(m.store, received(), false);
    expect(out).toMatchObject({ result: "recovered", messageExisted: true });
    expect([...m.messages.keys()]).toEqual(["AC-1"]);
  });

  it("files a call transcript under the call's conversation", async () => {
    const m = memoryStore({ messages: [{ quo_message_id: "CALL-1:call.completed", conversation_id: "conv-3" }] });
    const transcript: StuckEvent = { id: "event-2", event_type: "call.transcript.completed", raw_payload: {
      type: "call.transcript.completed", data: { object: { object: "call", id: "CALL-1", direction: "incoming", from: "+15550100001", to: ["+15550100999"],
        dialogue: [{ content: "Hello" }], createdAt: "2026-11-09T20:06:00.000Z" } } } };
    expect(await recoverStuckEvent(m.store, transcript, false)).toMatchObject({ result: "recovered" });
    expect(m.messages.get("CALL-1:call.transcript.completed")).toMatchObject({ conversation_id: "conv-3" });
  });

  it("marks a transcript whose call is unknown as failed with the reason, instead of leaving it stuck", async () => {
    const m = memoryStore();
    const orphan: StuckEvent = { id: "event-3", event_type: "call.summary.completed", raw_payload: { data: { object: { object: "call", id: "CALL-X", summary: "x" } } } };
    expect(await recoverStuckEvent(m.store, orphan, false)).toMatchObject({ result: "failed" });
    expect(m.events.get("event-3")?.status).toBe("failed");
    expect(m.writes).not.toContain("message");
  });

  it("marks an unreadable payload ignored, as the webhook does", async () => {
    const m = memoryStore();
    const out = await recoverStuckEvent(m.store, { id: "event-4", event_type: "message.received", raw_payload: { data: {} } }, false);
    expect(out.result).toBe("ignored");
    expect(m.events.get("event-4")?.status).toBe("ignored");
  });

  it("records a database error as failed and keeps going", async () => {
    const m = memoryStore({ failOn: "message", conversations: [{ id: "conv-9", quo_conversation_id: "CN-1", linked_lead_id: null, last_message_at: null }] });
    const out = await recoverStuckEvent(m.store, received(), false);
    expect(out).toEqual({ result: "failed", reason: "message unavailable" });
    expect(m.events.get("event-1")).toEqual({ status: "failed", note: "Recovery: message unavailable" });
  });

  it("dry run reports what would happen and writes nothing", async () => {
    const m = memoryStore();
    expect(await recoverStuckEvent(m.store, received(), true)).toEqual({ result: "recovered", messageExisted: false, conversationCreated: true });
    expect(m.writes).toEqual([]);
    expect(m.events.size).toBe(0);
  });

  it("orders calls before their transcripts and summaries, oldest first", () => {
    const ev = (id: string, event_type: string, received_at: string) => ({ id, event_type, received_at, raw_payload: {} });
    const ordered = recoveryOrder([
      ev("t", "call.transcript.completed", "2026-11-09T20:00:01Z"),
      ev("c", "call.completed", "2026-11-09T20:00:02Z"),
      ev("m", "message.received", "2026-11-09T20:00:00Z"),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(["m", "c", "t"]);
  });
});
