import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { CHECKED_STAMP_CHUNK, markLeadsChecked, type CheckedStampDb } from "../../supabase/functions/_shared/urgent-status-checks";

type Call = { table: string; values: { checked_at: string }; column: string; ids: string[] };

function fakeDb(fail: (call: Call, index: number) => string | null = () => null) {
  const calls: Call[] = [];
  const db: CheckedStampDb = {
    from: (table) => ({
      update: (values) => ({
        in: (column, ids) => {
          const call = { table, values, column, ids };
          const message = fail(call, calls.length);
          calls.push(call);
          return Promise.resolve({ error: message ? { message } : null });
        },
      }),
    }),
  };
  return { db, calls };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const AT = "2026-11-10T14:30:00.000Z";

describe("batched AI status checked stamps", () => {
  it("stamps 40 unchanged leads with one UPDATE instead of 40", async () => {
    const { db, calls } = fakeDb();
    const result = await markLeadsChecked(db, ids(40), AT);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ table: "lead_ai_statuses", values: { checked_at: AT }, column: "lead_id", ids: ids(40) });
    expect(result).toEqual({ stamped: 40, failed: 0 });
  });

  it("only moves checked_at and never touches the label", async () => {
    const { db, calls } = fakeDb();
    await markLeadsChecked(db, ids(3), AT);
    expect(Object.keys(calls[0].values)).toEqual(["checked_at"]);
  });

  it("splits large runs into chunks that keep the request URL short", async () => {
    const { db, calls } = fakeDb();
    const result = await markLeadsChecked(db, ids(CHECKED_STAMP_CHUNK * 2 + 7), AT);
    expect(calls.map((call) => call.ids.length)).toEqual([CHECKED_STAMP_CHUNK, CHECKED_STAMP_CHUNK, 7]);
    expect(new Set(calls.flatMap((call) => call.ids)).size).toBe(CHECKED_STAMP_CHUNK * 2 + 7);
    expect(result.stamped).toBe(CHECKED_STAMP_CHUNK * 2 + 7);
  });

  it("makes no request when every chat changed (nothing to stamp)", async () => {
    const { db, calls } = fakeDb();
    expect(await markLeadsChecked(db, [], AT)).toEqual({ stamped: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("de-duplicates ids and ignores empty ones", async () => {
    const { db, calls } = fakeDb();
    const [a, b] = ids(2);
    await markLeadsChecked(db, [a, b, a, "", b], AT);
    expect(calls[0].ids).toEqual([a, b]);
  });

  it("reports a failed chunk, keeps writing the others, and logs without customer data", async () => {
    const log = vi.fn();
    const { db, calls } = fakeDb((_call, index) => (index === 0 ? "upstream timeout" : null));
    const result = await markLeadsChecked(db, ids(CHECKED_STAMP_CHUNK + 5), AT, log);
    expect(calls).toHaveLength(2);
    expect(result).toEqual({ stamped: 5, failed: CHECKED_STAMP_CHUNK });
    expect(log).toHaveBeenCalledWith("checked_stamp_failed", { leads: CHECKED_STAMP_CHUNK, error: "upstream timeout" });
  });

  it("treats a thrown request like a failed chunk instead of aborting the run", async () => {
    const db: CheckedStampDb = { from: () => ({ update: () => ({ in: () => Promise.reject(new Error("network")) }) }) };
    expect(await markLeadsChecked(db, ids(2), AT)).toEqual({ stamped: 0, failed: 2 });
  });
});

// Compile-time check (npm run typecheck): the Edge Function passes its real
// service-role Supabase client, so the client must satisfy CheckedStampDb.
export function assertRealClientFits() {
  const admin = createClient("https://synthetic.invalid", "synthetic-key");
  return markLeadsChecked(admin, [], AT);
}
