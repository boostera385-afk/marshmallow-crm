import { afterEach, describe, expect, it } from "vitest";
import {
  LEADS_DELTA_OVERLAP_MS,
  LEADS_FULL_RECONCILE_MS,
  LEADS_RECONCILE_MAX_POSTPONE_MS,
  deltaSince,
  getLastFullLoad,
  laterCursor,
  leadsCursor,
  markFullLoad,
  mergeLeadChanges,
  needsFullReconcile,
  resetLeadsSyncState,
} from "./leads-sync";

afterEach(resetLeadsSyncState);

describe("leadsCursor", () => {
  it("returns the newest updated_at, ignoring missing and invalid values", () => {
    expect(leadsCursor([
      { updated_at: "2026-11-10T10:00:00.000Z" },
      { updated_at: null },
      { updated_at: "not a date" },
      { updated_at: "2026-11-10T12:30:00.000Z" },
      {},
      { updated_at: "2026-11-10T11:00:00.000Z" },
    ])).toBe("2026-11-10T12:30:00.000Z");
  });

  it("is null for rows from an old cache that never stored updated_at", () => {
    expect(leadsCursor([{}, { updated_at: null }])).toBeNull();
    expect(leadsCursor([])).toBeNull();
  });
});

describe("laterCursor", () => {
  it("never moves the cursor backwards", () => {
    expect(laterCursor("2026-11-10T12:00:00Z", "2026-11-10T11:00:00Z")).toBe("2026-11-10T12:00:00Z");
    expect(laterCursor("2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z")).toBe("2026-11-10T13:00:00Z");
    expect(laterCursor(null, "2026-11-10T13:00:00Z")).toBe("2026-11-10T13:00:00Z");
    expect(laterCursor("2026-11-10T12:00:00Z", null)).toBe("2026-11-10T12:00:00Z");
  });
});

describe("deltaSince", () => {
  it("re-reads an overlap before the cursor so late-committing changes are not missed", () => {
    const cursor = "2026-11-10T12:00:00.000Z";
    expect(Date.parse(cursor) - Date.parse(deltaSince(cursor))).toBe(LEADS_DELTA_OVERLAP_MS);
  });
});

describe("needsFullReconcile", () => {
  it("requires a complete load when none was made or the last one is too old", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(needsFullReconcile(null, now)).toBe(true);
    expect(needsFullReconcile(now - LEADS_FULL_RECONCILE_MS, now)).toBe(true);
    expect(needsFullReconcile(now - LEADS_FULL_RECONCILE_MS + 1, now)).toBe(false);
  });

  it("postpones the periodic reload while the server reports raised load, up to a cap", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(needsFullReconcile(now - LEADS_FULL_RECONCILE_MS, now, true)).toBe(false);
    expect(needsFullReconcile(now - LEADS_RECONCILE_MAX_POSTPONE_MS + 1, now, true)).toBe(false);
    expect(needsFullReconcile(now - LEADS_RECONCILE_MAX_POSTPONE_MS, now, true)).toBe(true);
    expect(needsFullReconcile(null, now, true)).toBe(true);
  });
});

describe("full-load bookkeeping", () => {
  it("is tracked per caller scope and can be cleared", () => {
    markFullLoad("admin:a", 100);
    markFullLoad("customer_service:b", 200);
    expect(getLastFullLoad("admin:a")).toBe(100);
    expect(getLastFullLoad("customer_service:b")).toBe(200);
    markFullLoad("admin:a", null);
    expect(getLastFullLoad("admin:a")).toBeNull();
    expect(getLastFullLoad("customer_service:b")).toBe(200);
  });
});

describe("mergeLeadChanges", () => {
  const lead = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({ id, created_at, status: "new", ...extra });

  it("updates existing rows in place and keeps their position", () => {
    const current = [lead("a", "2026-11-10T03:00:00Z"), lead("b", "2026-11-10T02:00:00Z"), lead("c", "2026-11-10T01:00:00Z")];
    const next = mergeLeadChanges(current, [lead("b", "2026-11-10T02:00:00Z", { status: "quoted" })]);
    expect(next.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(next[1].status).toBe("quoted");
    expect(next[0]).toBe(current[0]);
  });

  it("adds new rows at the front, newest first, and never drops existing rows", () => {
    const current = [lead("a", "2026-11-10T03:00:00Z")];
    const next = mergeLeadChanges(current, [lead("x", "2026-11-10T04:00:00Z"), lead("y", "2026-11-10T05:00:00Z")]);
    expect(next.map((row) => row.id)).toEqual(["y", "x", "a"]);
  });

  it("keeps fields the change does not carry", () => {
    const current = [lead("a", "2026-11-10T03:00:00Z", { quote: "card-only field" })];
    const next = mergeLeadChanges(current, [{ id: "a", created_at: "2026-11-10T03:00:00Z", status: "paid" }]);
    expect(next[0]).toMatchObject({ status: "paid", quote: "card-only field" });
  });

  it("returns the same list when nothing changed, so React skips a render", () => {
    const current = [lead("a", "2026-11-10T03:00:00Z")];
    expect(mergeLeadChanges(current, [])).toBe(current);
  });
});
