import { z } from "zod";
import { workflowCall } from "@/lib/workflow-inbox";

const row = z.object({ lead_id: z.string().uuid(), job_id: z.string(), status: z.string(), eligible: z.boolean(),
  scheduled_date: z.string().nullable(), scheduled_time_start: z.string().nullable(), schedule_requirements: z.string().nullable(), timezone: z.string().nullable(),
  evidence: z.object({ text: z.string().nullable(), message_time: z.string().nullable(), sender: z.string().nullable(), direction: z.string().nullable() }).nullable(),
  conversation_id: z.string().uuid().nullable(), verified_at: z.string().nullable(), state: z.string(), generation: z.number().nullable(),
  checked_at: z.string().nullable(), result: z.object({ decision: z.string(), reason: z.string().nullable(), evidence_id: z.string().nullable(), applied: z.boolean() }).nullable(),
  review_decision: z.string().nullable(), candidates: z.array(z.object({ id: z.string().uuid(), number_id: z.string().nullable(), last_message_time: z.string().nullable() })),
});
const schema = z.object({ mode: z.enum(["off", "shadow", "automatic"]), timezone: z.string(), changed_at: z.string(), cooldown_until: z.string().nullable(), shadow_started_at: z.string().nullable(),
  accepted: z.number(), rejected: z.number(), daily_checks: z.number(), ingestion_paused: z.boolean(), total: z.number(), rows: z.array(row) });
export type ScheduleMonitorRow = z.infer<typeof row>;
export type ScheduleMonitorMode = z.infer<typeof schema>["mode"];
export const fetchScheduleMonitor = async (offset: number) => schema.parse(await workflowCall("schedule", { action: "status", offset }));
export const changeScheduleMonitor = async (input: object) => z.object({ saved: z.literal(true) }).parse(await workflowCall("schedule", input));
