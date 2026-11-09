import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/**
 * Paid-lead grants (migrations 20261204000000_paid_lead_access and
 * 20261205000000_paid_lead_access_by_paid_date). An Admin switches Paid on for a
 * user and picks All time or a date range of the date each lead BECAME PAID (not
 * its created date). The database enforces it (lead RLS "Granted paid leads") and
 * returns the caller's in-window ids (my_paid_lead_ids), so the CRM's lists and
 * counts match what the database returns without exposing paid dates.
 */
// Grant dates are New York calendar days; the database applies them.
export const paidLeadAccessSchema = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  granted_by_name: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});
export type PaidLeadAccess = z.infer<typeof paidLeadAccessSchema>;
export type PaidAccessChoice = { mode: "all" } | { mode: "range"; start: string; end: string };

/** Admin: every grant. Anyone else: their own (RLS). */
export async function fetchPaidLeadAccess(): Promise<PaidLeadAccess[]> {
  const { data, error } = await supabase.from("paid_lead_access" as never).select("user_id, start_date, end_date, granted_by_name, updated_at");
  if (error) throw error;
  return z.array(paidLeadAccessSchema).parse(data ?? []);
}

/** Admin only (checked in the database). */
export async function setPaidLeadAccess(userId: string, choice: PaidAccessChoice | null): Promise<void> {
  const args = {
    p_user_id: userId,
    p_enabled: choice !== null,
    p_start: choice?.mode === "range" ? choice.start : null,
    p_end: choice?.mode === "range" ? choice.end : null,
  };
  const { error } = await supabase.rpc("set_paid_lead_access" as never, args as never);
  if (error) throw error;
}

/** The caller's paid lead ids inside their grant window (empty without a grant). */
export async function fetchMyPaidLeadIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc("my_paid_lead_ids" as never);
  if (error) throw error;
  return z.array(z.string().uuid()).parse(data ?? []);
}

/**
 * True when a paid lead is in the user's grant: all time covers every paid lead;
 * a range covers the ids the database reports for it. Until those ids load (or if
 * they cannot be read) a ranged grant shows no paid leads rather than guessing.
 */
export function isInPaidGrant(
  leadId: string,
  access: Pick<PaidLeadAccess, "start_date" | "end_date"> | null | undefined,
  idsInWindow: ReadonlySet<string> | null | undefined,
): boolean {
  if (!access) return false;
  if (!access.start_date || !access.end_date) return true;
  return idsInWindow?.has(leadId) ?? false;
}

const formatDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "All time" / "Oct 1, 2026 – Oct 31, 2026". */
export function describePaidWindow(access: Pick<PaidLeadAccess, "start_date" | "end_date"> | null | undefined): string {
  if (!access) return "";
  if (!access.start_date || !access.end_date) return "All time";
  return `${formatDay(access.start_date)} – ${formatDay(access.end_date)}`;
}

/** Validates the dialog's choice; returns an error message or null. */
export function validatePaidChoice(choice: PaidAccessChoice): string | null {
  if (choice.mode === "all") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(choice.start) || !/^\d{4}-\d{2}-\d{2}$/.test(choice.end)) return "Choose a start and an end date.";
  if (choice.start > choice.end) return "The start date must be on or before the end date.";
  return null;
}
