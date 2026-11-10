/**
 * Incremental ("delta") sync for the Leads page.
 *
 * The Leads page needs every lead the caller can see (exact status counts,
 * client-side search and filters), so the first load pages the whole table.
 * After that, nearly nothing changes: on 2026-11-09 only 104 of 5,450 leads
 * changed in 24 hours, yet every visible tab re-downloaded all of them every
 * 60 seconds (6 × 1,000-row requests, ~40% of all database time).
 *
 * Instead, after one complete load we ask only for rows whose `updated_at`
 * moved past a cursor. `leads.updated_at` defaults to now() and is maintained
 * by the `leads_set_updated_at` trigger, so inserts and updates both advance
 * it. Measured as an admin, the delta query costs ~2 ms against ~15–190 ms per
 * 1,000-row page of the full read.
 *
 * What a delta cannot see, and how it is still covered:
 *  - deletions: realtime DELETE events remove the row immediately;
 *  - a lead leaving the caller's visibility without being deleted: a full
 *    reload replaces the list at most every LEADS_FULL_RECONCILE_MS, and right
 *    after realtime reconnects.
 */
/** Re-read rows changed this long before the cursor, for transactions that commit late. */
export const LEADS_DELTA_OVERLAP_MS = 2 * 60 * 1000;
/** A delta this large means "a lot changed": do a complete reload instead. */
export const LEADS_DELTA_LIMIT = 1000;
/** A complete reload at least this often while the page is in use. */
export const LEADS_FULL_RECONCILE_MS = 30 * 60 * 1000;

type Stamped = { updated_at?: string | null };

/** The newest `updated_at` among rows, or null if none carry one (e.g. an old cache). */
export function leadsCursor(rows: readonly Stamped[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const row of rows) {
    const value = row.updated_at;
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

/** The later of two cursors (null-safe). */
export function laterCursor(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Lower bound for the delta query: the cursor minus the overlap. */
export function deltaSince(cursor: string): string {
  return new Date(Date.parse(cursor) - LEADS_DELTA_OVERLAP_MS).toISOString();
}

/** True when the last complete load is too old to keep trusting deltas alone. */
export function needsFullReconcile(lastFullAt: number | null, now: number = Date.now()): boolean {
  return lastFullAt === null || now - lastFullAt >= LEADS_FULL_RECONCILE_MS;
}

/**
 * Apply changed rows to the current list: rows already present are updated in
 * place (fields merged, order kept), new rows are added at the front, newest
 * first. Nothing is ever removed here; removals come from realtime DELETE
 * events and full reloads.
 */
export function mergeLeadChanges<T extends { id: string; created_at?: string | null }>(current: T[], changes: readonly T[]): T[] {
  if (changes.length === 0) return current;
  const byId = new Map<string, T>();
  for (const row of changes) if (row?.id) byId.set(row.id, row);
  if (byId.size === 0) return current;

  let touched = false;
  const next = current.map((row) => {
    const change = byId.get(row.id);
    if (!change) return row;
    byId.delete(row.id);
    touched = true;
    return { ...row, ...change };
  });
  const added = [...byId.values()].sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""));
  if (!touched && added.length === 0) return current;
  return added.length ? [...added, ...next] : next;
}

/**
 * When each caller scope last completed a full load in this browser session.
 * Kept at module level so navigating away from Leads and back does not force
 * another full read.
 */
const lastFullLoadAt = new Map<string, number>();
export function getLastFullLoad(scope: string): number | null {
  return lastFullLoadAt.get(scope) ?? null;
}
export function markFullLoad(scope: string, at: number | null = Date.now()): void {
  if (at === null) lastFullLoadAt.delete(scope);
  else lastFullLoadAt.set(scope, at);
}
/** Forget all scopes (tests, sign-out). */
export function resetLeadsSyncState(): void {
  lastFullLoadAt.clear();
}
