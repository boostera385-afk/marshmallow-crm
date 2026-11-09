import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const read: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { read[key] = value; return query; },
        in: (key: string, value: unknown) => { read[key] = value; return query; },
        gte: (key: string, value: unknown) => { read[`${key}>=`] = value; return query; },
        order: () => query,
        limit: (value: number) => {
          read.limit = value;
          state.reads.push(read);
          return Promise.resolve({ data: state.error ? null : state.rows, error: state.error });
        },
      };
      return query;
    },
  },
}));
import { isAlertOfKind, PER_KIND_LIMIT, readActiveAlerts } from "@/lib/active-alerts";

const row = (kind: string, id: string) => ({ id, kind, title: kind, message: "", lead_id: null, created_at: "2026-11-09T00:00:00Z", read: false });

beforeEach(() => { vi.useFakeTimers(); state.reads = []; state.rows = []; state.error = null; });
afterEach(() => { vi.useRealTimers(); });

describe("pop-up alerts read through one batched query", () => {
  it("merges the pop-ups' reads into one query and gives each its own type", async () => {
    state.rows = [row("urgent_job", "u1"), row("quote_updated", "q1"), row("urgent_job", "u2")];
    const urgent = readActiveAlerts("user-1", null, "urgent_job");
    const quote = readActiveAlerts("user-1", null, "quote_updated");
    await vi.advanceTimersByTimeAsync(30);
    await expect(urgent).resolves.toEqual([row("urgent_job", "u1"), row("urgent_job", "u2")]);
    await expect(quote).resolves.toEqual([row("quote_updated", "q1")]);
    expect(state.reads).toHaveLength(1);
    expect(state.reads[0]).toMatchObject({ user_id: "user-1", read: false, kind: ["urgent_job", "quote_updated"], limit: 2 * PER_KIND_LIMIT });
  });

  it("caps each type at its own limit", async () => {
    state.rows = Array.from({ length: PER_KIND_LIMIT + 5 }, (_, i) => row("urgent_job", `u${i}`));
    const urgent = readActiveAlerts("user-1", null, "urgent_job");
    await vi.advanceTimersByTimeAsync(30);
    await expect(urgent).resolves.toHaveLength(PER_KIND_LIMIT);
  });

  it("reports a failed read to every pop-up in the batch", async () => {
    state.error = { message: "statement timeout" };
    const urgent = readActiveAlerts("user-1", null, "urgent_job");
    const job = readActiveAlerts("user-1", null, "job_in_progress");
    const both = Promise.allSettled([urgent, job]);
    await vi.advanceTimersByTimeAsync(30);
    expect((await both).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });

  it("keeps different users in separate reads", async () => {
    const a = readActiveAlerts("user-a", null, "urgent_job");
    const b = readActiveAlerts("user-b", null, "urgent_job");
    await vi.advanceTimersByTimeAsync(30);
    await Promise.all([a, b]);
    expect(state.reads.map((read) => read.user_id).sort()).toEqual(["user-a", "user-b"]);
  });

  it("matches realtime rows by kind, and old rows by title", () => {
    expect(isAlertOfKind({ kind: "urgent_job", title: "anything" }, "urgent_job")).toBe(true);
    expect(isAlertOfKind({ kind: "quote_updated", title: "[Alert] Urgent Job" }, "urgent_job")).toBe(false);
    expect(isAlertOfKind({ kind: null, title: "🚨 Urgent Job" }, "urgent_job")).toBe(true);
    expect(isAlertOfKind(null, "urgent_job")).toBe(false);
  });
});
