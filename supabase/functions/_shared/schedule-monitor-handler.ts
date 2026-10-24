import { parseScheduleBatch, type ScheduleCheck, type ScheduleDecision } from "./schedule-confirmation.ts";

export interface ScheduleMonitorDb {
  rpc(name: "claim_schedule_checks" | "finish_schedule_check", args?: { p_input: Record<string, unknown> }): PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
}
export function createScheduleMonitorHandler(deps: {
  authenticate: (req: Request) => Promise<ScheduleMonitorDb | null>;
  assess: (job: ScheduleCheck) => Promise<ScheduleDecision>;
}) {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return async (req: Request) => {
    if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
    try {
      const db = await deps.authenticate(req);
      if (!db) return reply({ error: "Worker authentication required" }, 401);
      const claim = await db.rpc("claim_schedule_checks");
      if (claim.error) return reply({ error: "Could not claim schedule checks" }, 503);
      const batch = parseScheduleBatch(claim.data);
      let saved = 0, failed = 0, stale = 0;
      let limited = false;
      for (const job of batch.rows) {
        // Sequential bounded processing avoids provider bursts. A 429 stops all
        // further provider calls in this batch and starts a database cooldown.
        let result: ScheduleDecision;
        try { result = limited ? { decision: "unavailable", reason: "Provider cooldown; retry later.", provider_status: 429 } : await deps.assess(job); }
        catch { result = { decision: "unavailable", reason: "Assessment failed. No tag change." }; }
        if (result.provider_status === 429) limited = true;
        const finish = await db.rpc("finish_schedule_check", { p_input: {
          lead_id: job.lead_id, lease: job.lease, generation: job.generation, mode: batch.mode, timezone: batch.timezone,
          config_changed_at: batch.config_changed_at, result, provider_status: result.provider_status,
        } });
        if (!finish.error) {
          if (finish.data !== true) stale++;
          else saved++;
        }
        // Failed counts jobs, not error stages: provider + persistence failure
        // for the same job must not inflate the batch's failure count.
        if (finish.error || result.decision === "unavailable") failed++;
      }
      // Partial provider failures are explicit, never a misleading healthy 200.
      return reply({ mode: batch.mode, total: batch.rows.length, saved, failed, stale }, failed ? 503 : 200);
    } catch { return reply({ error: "Schedule worker unavailable" }, 503); }
  };
}
