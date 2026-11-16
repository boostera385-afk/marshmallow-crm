import type { Lead } from "@/types";

export type QuoteTerms = "quoted" | "free_estimate" | "diagnostic_service_call";

export type QuoteFormValue = {
  terms: "" | QuoteTerms;
  /** Customer labor for Quoted; the diagnostic/service call fee for Diagnostic/Service Call. */
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
 * Terms that record a customer amount in `labor_amount`: Quoted (labor) and
 * Diagnostic/Service Call (the diagnostic fee). Only Quoted has Parts/Materials.
 */
export const termsRecordAmount = (terms: string | null | undefined) =>
  terms === "quoted" || terms === "diagnostic_service_call";
export const termsAllowMaterials = (terms: string | null | undefined) => terms === "quoted";

export const hasMaterialCharge = (amount: number | null | undefined) => amount != null && Number.isFinite(amount) && amount > 0;
export const quoteMoney = (amount: number) => `$${amount.toFixed(2)}`;

export function validateQuoteBreakdown(value: QuoteFormValue): string | null {
  if (!termsRecordAmount(value.terms)) return null;
  const invalidAmount = value.laborAmount.trim() && (!Number.isFinite(Number(value.laborAmount)) || Number(value.laborAmount) < 0);
  if (value.terms === "diagnostic_service_call") return invalidAmount ? "Enter a valid non-negative diagnostic fee" : null;
  if (invalidAmount) return "Enter a valid non-negative labor amount";
  if (value.includesMaterials && (!value.materialAmount.trim() || !hasMaterialCharge(Number(value.materialAmount)))) return "Enter a positive Parts/Materials amount or choose No";
  return null;
}

/** Customer-facing quote only; never the internal For You / For Us split. */
export function customerQuoteSummary(lead: Partial<Pick<Lead, "terms" | "labor_amount" | "material_amount" | "quote">>): string | null {
  if (lead.terms === "free_estimate") return QUOTE_TERM_LABELS.free_estimate;
  if (lead.terms === "diagnostic_service_call") {
    const parts: string[] = [QUOTE_TERM_LABELS.diagnostic_service_call];
    if (lead.labor_amount != null && Number.isFinite(lead.labor_amount)) parts.push(`Fee ${quoteMoney(lead.labor_amount)}`);
    return parts.join(" · ");
  }
  if (lead.terms !== "quoted") return lead.quote?.trim() || null;
  const parts = ["Quoted"];
  if (lead.labor_amount != null && Number.isFinite(lead.labor_amount)) parts.push(`Labor ${quoteMoney(lead.labor_amount)}`);
  if (hasMaterialCharge(lead.material_amount)) parts.push(`Parts/Materials ${quoteMoney(lead.material_amount)}`);
  return parts.join(" · ");
}
