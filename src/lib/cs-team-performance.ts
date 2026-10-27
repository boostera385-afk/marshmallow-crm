import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export type CsMemberRow = { id: string; name: string; role: "CS" | "CS Admin"; totalAdded: number; engaged: number; scheduled: number; completed: number; conversionRate: string };

const count = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().nonnegative());
const rowSchema = z.object({ member_id: z.string(), member_name: z.string().nullable(), member_role: z.enum(["customer_service", "cs_admin"]), total_added: count, engaged: count, scheduled: count, completed: count });

/** Shared by the team-wide report and the caller-scoped fallback: same columns, same order. */
export function toCsMemberRow(member: { id: string; name: string | null; role: "customer_service" | "cs_admin"; total: number; engaged: number; scheduled: number; completed: number }): CsMemberRow {
  return { id: member.id, name: member.name || "Unknown CS Agent", role: member.role === "cs_admin" ? "CS Admin" : "CS", totalAdded: member.total, engaged: member.engaged,
    scheduled: member.scheduled, completed: member.completed, conversionRate: member.total > 0 ? ((member.completed / member.total) * 100).toFixed(1) : "0.0" };
}

/**
 * Team-wide CS Team Performance counts (aggregates only, no lead rows). The
 * database allows Admin and users granted "CS Team Performance" in Feature Access.
 */
export async function fetchCsTeamPerformance(startMs: number, endMs: number): Promise<CsMemberRow[]> {
  // Not in the generated types until they are regenerated after the migration.
  const { data, error } = await supabase.rpc("cs_team_performance" as never, { p_start: new Date(startMs).toISOString(), p_end: new Date(endMs).toISOString() } as never);
  if (error) throw new Error(error.code === "42501" ? "CS Team Performance is not enabled for your account. Ask an Admin." : "CS Team Performance could not be loaded. Retry in a moment.");
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("CS Team Performance returned unexpected data. Retry in a moment.");
  return parsed.data
    .map((row) => toCsMemberRow({ id: row.member_id, name: row.member_name, role: row.member_role, total: row.total_added, engaged: row.engaged, scheduled: row.scheduled, completed: row.completed }))
    .sort((a, b) => b.totalAdded - a.totalAdded || a.name.localeCompare(b.name));
}
