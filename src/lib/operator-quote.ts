import type { Lead } from "@/types";

/**
 * What an Operator (`opr`) may see of a quote (business rule 2026-11-13):
 * the Quoted/Free Estimate terms, half the labor amount, and the full materials
 * amount when there is one. Never the free-text `quote`, the full labor amount, or
 * the For You/For Us technician split. `show_quote_to_opr` (an admin per-lead
 * toggle predating this rule) still lets an admin hide quote details from a
 * specific Operator entirely.
 */

/** Half of the Customer Labor amount, rounded to the cent. */
export function operatorVisibleLabor(laborAmount: number | null | undefined): number | null {
  if (laborAmount == null || !Number.isFinite(laborAmount)) return null;
  return Math.round((laborAmount / 2) * 100) / 100;
}

const money = (amount: number) => `$${amount.toFixed(2)}`;

export type OperatorQuoteLead = {
  terms?: Lead["terms"];
  labor_amount?: Lead["labor_amount"];
  material_amount?: Lead["material_amount"];
  show_quote_to_opr?: boolean | null;
};

/** null when there is nothing an Operator may be told about the quote yet. */
export function operatorQuoteSummary(lead: OperatorQuoteLead): string | null {
  if (lead.show_quote_to_opr === false) return null;
  if (lead.terms === "free_estimate") return "Free Estimate Visit";
  if (lead.terms !== "quoted") return null;

  const half = operatorVisibleLabor(lead.labor_amount);
  const materials = lead.material_amount;
  const hasMaterials = materials != null && Number.isFinite(materials) && materials > 0;

  const parts: string[] = ["Quoted"];
  if (half != null) parts.push(`Labor ${money(half)}`);
  if (hasMaterials) parts.push(`Materials ${money(materials as number)}`);
  // "Quoted" alone still tells the Operator the job's terms, as it does for opr_admin;
  // labor/materials are appended only when recorded (never inferred from quote text).
  return parts.join(" · ");
}
