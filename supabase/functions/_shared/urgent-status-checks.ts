// =============================================================================
// Batched "checked" stamps for refresh-urgent-statuses.
//
// When a cron run finds a lead's chat unchanged since its last check, the label
// cannot have changed; only `checked_at` moves forward (the Leads page shows the
// newest one as "AI statuses last checked ..."). That used to be one UPDATE
// request per lead (~900 a night). This sends one UPDATE per chunk of leads.
//
// The same rows are still written (each still produces one row change), so
// what this saves is requests, round trips and connection time, not row writes.
// =============================================================================

/** Lead ids per UPDATE, keeping the `in.(...)` filter well inside URL limits. */
export const CHECKED_STAMP_CHUNK = 150;

type UpdateResult = PromiseLike<{ error: { message: string } | null }>;
export interface CheckedStampDb {
  from(table: "lead_ai_statuses"): {
    update(values: { checked_at: string }): { in(column: "lead_id", values: string[]): UpdateResult };
  };
}

export interface CheckedStampResult {
  /** Leads whose checked_at was moved to `checkedAt`. */
  stamped: number;
  /** Leads left with their previous checked_at because their chunk failed. */
  failed: number;
}

/**
 * Stamp `checkedAt` on every given lead's AI status row, in chunks. A failed
 * chunk is reported and skipped; the other chunks are still written. Labels are
 * never touched.
 */
export async function markLeadsChecked(
  db: CheckedStampDb,
  leadIds: readonly string[],
  checkedAt: string,
  log: (message: string, detail: Record<string, unknown>) => void = () => {},
): Promise<CheckedStampResult> {
  const ids = [...new Set(leadIds.filter((id) => typeof id === "string" && id.length > 0))];
  let stamped = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += CHECKED_STAMP_CHUNK) {
    const chunk = ids.slice(i, i + CHECKED_STAMP_CHUNK);
    try {
      const { error } = await db.from("lead_ai_statuses").update({ checked_at: checkedAt }).in("lead_id", chunk);
      if (error) throw new Error(error.message);
      stamped += chunk.length;
    } catch (error) {
      failed += chunk.length;
      log("checked_stamp_failed", { leads: chunk.length, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { stamped, failed };
}
