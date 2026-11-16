import type { Lead } from "@/types";

export type QuoteTerms = "quoted" | "free_estimate" | "diagnostic_service_call";

export type QuoteFormValue = {
  terms: "" | QuoteTerms;
  /** Customer labor (Quoted only). The diagnostic fee is leads.diagnostic_fee_amount. */
  laborAmount: string;
  materialAmount: string;
  includesMaterials: boolean;
};

/** Display label for each quote term, used everywhere a lead's terms are shown. */
export const QUOTE_TERM_LABELS: Record<QuoteTerms, string> = {
  quoted: "Quoted",
  free_estimate: "Free Estimate Visit",
  diagnostic_service_call: "Diagnostic/Service Call",
};

export const quoteTermLabel = (terms: string | null | undefined): string | null =>
  terms && terms in QUOTE_TERM_LABELS ? QUOTE_TERM_LABELS[terms as QuoteTerms] : null;

/**
 * Terms that record customer labor in `labor_amount` (and may have Parts/Materials):
 * Quoted only. The Diagnostic Fee has its own column, `diagnostic_fee_amount`,
 * entered beside For You / For Us on every term (2026-11-16).
 */
export const termsRecordAmount = (terms: string | null | undefined) => terms === "quoted";
export const termsAllowMaterials = (terms: string | null | undefined) => terms === "quoted";

export const hasMaterialCharge = (amount: number | null | undefined) => amount != null && Number.isFinite(amount) && amount > 0;
export const quoteMoney = (amount: number) => `$${amount.toFixed(2)}`;

export function validateQuoteBreakdown(value: QuoteFormValue): string | null {
  if (!termsRecordAmount(value.terms)) return null;
  if (value.laborAmount.trim() && (!Number.isFinite(Number(value.laborAmount)) || Number(value.laborAmount) < 0)) return "Enter a valid non-negative labor amount";
  if (value.includesMaterials && (!value.materialAmount.trim() || !hasMaterialCharge(Number(value.materialAmount)))) return "Enter a positive Parts/Materials amount or choose No";
  return null;
}

export type TechnicianShareField =
  | "for_you_amount"
  | "for_us_amount"
  | "for_you_labor_percent"
  | "for_us_labor_percent"
  | "diagnostic_fee_amount"
  | "for_you_diagnostic_amount"
  | "for_us_diagnostic_amount";

/**
 * Which Internal Technician Share fields a term uses (owner formats 2026-11-16).
 * Labor share: Quoted and no terms in dollars (for_you_amount / for_us_amount),
 * Free Estimate and Diagnostic/Service Call in % of labor. The Diagnostic Fee and
 * its own For You / For Us split are offered on every term.
 */
export function technicianShareFieldsForTerms(terms: string | null | undefined): TechnicianShareField[] {
  const diagnostic: TechnicianShareField[] = ["diagnostic_fee_amount", "for_you_diagnostic_amount", "for_us_diagnostic_amount"];
  const percents: TechnicianShareField[] = ["for_you_labor_percent", "for_us_labor_percent"];
  if (terms === "diagnostic_service_call") return [...diagnostic, ...percents];
  if (terms === "free_estimate") return [...percents, ...diagnostic];
  return ["for_you_amount", "for_us_amount", ...diagnostic];
}

/** A labor percentage is valid when blank or a number from 0 to 100. */
export function validateLaborPercent(value: string): string | null {
  return value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) ? "Enter a labor percentage from 0 to 100" : null;
}

/** A Diagnostic Fee input is valid when blank or a non-negative number. */
export function validateDiagnosticFee(value: string): string | null {
  return value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0) ? "Enter a valid non-negative diagnostic fee" : null;
}

/** Customer-facing quote only; never the internal For You / For Us split. */
export function customerQuoteSummary(lead: Partial<Pick<Lead, "terms" | "labor_amount" | "material_amount" | "quote" | "diagnostic_fee_amount">>): string | null {
  if (lead.terms === "free_estimate") return QUOTE_TERM_LABELS.free_estimate;
  if (lead.terms === "diagnostic_service_call") {
    const parts: string[] = [QUOTE_TERM_LABELS.diagnostic_service_call];
    if (lead.diagnostic_fee_amount != null && Number.isFinite(lead.diagnostic_fee_amount)) parts.push(`Fee ${quoteMoney(lead.diagnostic_fee_amount)}`);
    return parts.join(" · ");
  }
  if (lead.terms !== "quoted") return lead.quote?.trim() || null;
  const parts = ["Quoted"];
  if (lead.labor_amount != null && Number.isFinite(lead.labor_amount)) parts.push(`Labor ${quoteMoney(lead.labor_amount)}`);
  if (hasMaterialCharge(lead.material_amount)) parts.push(`Parts/Materials ${quoteMoney(lead.material_amount)}`);
  return parts.join(" · ");
}
