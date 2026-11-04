import { z } from "zod";
import { workflowCall } from "@/lib/workflow-inbox";

const row = z.object({ lead_id: z.string().uuid(), job_id: z.string(), status: z.string(), customer_name: z.string().nullable(),
  service_type: z.string().nullable(), schedule_requirements: z.string().nullable(), eligible: z.boolean(), state: z.string(),
  waiting_since: z.string().nullable(), checked_at: z.string().nullable(),
  result: z.object({ decision: z.string(), reason: z.string().nullable(), quote: z.string().nullable().optional(), evidence_id: z.string().nullable(), applied: z.boolean() }).nullable(),
  evidence: z.object({ text: z.string().nullable(), message_time: z.string().nullable() }).nullable(),
});
const schema = z.object({ mode: z.enum(["off", "shadow", "automatic"]), changed_at: z.string(), cooldown_until: z.string().nullable(),
  daily_checks: z.number(), daily_limit: z.number(), ingestion_paused: z.boolean(), total: z.number(), rows: z.array(row) });
export type ScheduleMonitorRow = z.infer<typeof row>;
export type ScheduleMonitorMode = z.infer<typeof schema>["mode"];
export const fetchScheduleMonitor = async (offset: number) => schema.parse(await workflowCall("schedule", { action: "status", offset }));
export const changeScheduleMonitor = async (input: { action: "configure"; mode: ScheduleMonitorMode; reason: string; expectedChangedAt: string } | { action: "retry"; leadId: string; reason: string }) =>
  z.object({ saved: z.literal(true) }).parse(await workflowCall("schedule", input));
