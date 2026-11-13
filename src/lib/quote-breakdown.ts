import type { Lead } from "@/types";

export type QuoteFormValue = {
  terms: "" | "quoted" | "free_estimate";
  laborAmount: string;
  materialAmount: string;
  includesMaterials: boolean;
};

export const hasMaterialCharge = (amount: number | null | undefined) => amount != null && Number.isFinite(amount) && amount > 0;
export const quoteMoney = (amount: number) => `$${amount.toFixed(2)}`;

export function validateQuoteBreakdown(value: QuoteFormValue): string | null {
  if (value.terms !== "quoted") return null;
  if (value.laborAmount.trim() && (!Number.isFinite(Number(value.laborAmount)) || Number(value.laborAmount) < 0)) return "Enter a valid non-negative labor amount";
  if (value.includesMaterials && (!value.materialAmount.trim() || !hasMaterialCharge(Number(value.materialAmount)))) return "Enter a positive Parts/Materials amount or choose No";
  return null;
}

/** Customer-facing quote only; never the internal For You / For Us split. */
export function customerQuoteSummary(lead: Partial<Pick<Lead, "terms" | "labor_amount" | "material_amount" | "quote">>): string | null {
  if (lead.terms === "free_estimate") return "Free Estimate Visit";
  if (lead.terms !== "quoted") return lead.quote?.trim() || null;
  const parts = ["Quoted"];
  if (lead.labor_amount != null && Number.isFinite(lead.labor_amount)) parts.push(`Labor ${quoteMoney(lead.labor_amount)}`);
  if (hasMaterialCharge(lead.material_amount)) parts.push(`Parts/Materials ${quoteMoney(lead.material_amount)}`);
  return parts.join(" · ");
}
