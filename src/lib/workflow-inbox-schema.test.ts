import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inboxSchema } from "./workflow-inbox";

const row = (patch: object) => ({ id: "16000000-0000-4000-8000-000000000001", title: "AI: Customer requires new schedule", message: "Job ID: SYN-1",
  lead_id: null, read: false, created_at: "2026-11-06T10:00:00Z", event_type: "schedule_ready", event_kind: "schedule_new_needed",
  request_kind: null, request_id: null, revision: 2, job_id: "SYN-1", action_required: false, ...patch });

describe("notification list parsing", () => {
  it("keeps the exact alert type for the calendar icon", () => {
    expect(inboxSchema.parse({ rows: [row({})], total: 1, unread_count: 1 }).rows[0]).toMatchObject({ event_type: "schedule_ready", event_kind: "schedule_new_needed" });
  });
  it("never fails the whole list because of an alert type this build does not know", () => {
    const parsed = inboxSchema.parse({ rows: [row({ event_type: "some_future_type", event_kind: 7 }), row({ id: "16000000-0000-4000-8000-000000000002", event_type: "update_answered", event_kind: undefined })], total: 2, unread_count: 2 });
    expect(parsed.rows.map((r) => r.event_type)).toEqual([null, "update_answered"]);
    expect(parsed.rows[0].event_kind).toBeNull();
  });
  // The CRM build published before this change validates with this exact schema.
  // What the server now sends for a new-schedule alert must pass it.
  it("is accepted by the previously published CRM build", () => {
    const oldNotification = z.object({
      id: z.string().uuid(), title: z.string(), message: z.string(), lead_id: z.string().uuid().nullable(),
      read: z.boolean(), created_at: z.string(), event_type: z.enum(["update_requested", "update_answered", "update_resolved", "schedule_ready"]).nullable(),
      request_kind: z.enum(["cx", "tech"]).nullable(), request_id: z.string().uuid().nullable(), revision: z.number().nullable(),
      job_id: z.string().nullable(), action_required: z.boolean(),
    });
    const oldInbox = z.object({ rows: z.array(oldNotification), total: z.number().int().nonnegative(), unread_count: z.number().int().nonnegative() });
    expect(() => oldInbox.parse({ rows: [row({})], total: 1, unread_count: 1 })).not.toThrow();
    expect(() => oldInbox.parse({ rows: [row({ event_type: "schedule_new_needed" })], total: 1, unread_count: 1 })).toThrow();
  });
});
