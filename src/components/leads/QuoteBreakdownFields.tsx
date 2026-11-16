import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasMaterialCharge, quoteMoney, quoteTermLabel, QUOTE_TERM_LABELS, type QuoteFormValue } from "@/lib/quote-breakdown";

export default function QuoteBreakdownFields({ value, onChange, readOnly = false }: {
  value: QuoteFormValue;
  onChange: (value: QuoteFormValue) => void;
  readOnly?: boolean;
}) {
  const id = useId();
  const amountText = value.laborAmount.trim() && Number.isFinite(Number(value.laborAmount)) ? quoteMoney(Number(value.laborAmount)) : "Not recorded";
  if (readOnly) return <section aria-label="Quote breakdown" className="space-y-3 rounded-xl border border-border/60 p-4">
    <h3 className="text-sm font-semibold">Quote</h3>
    <p className="text-sm">{quoteTermLabel(value.terms) ?? "Terms not recorded"}</p>
    {value.terms === "quoted" && <>
      <div><h4 className="text-xs font-semibold">Labor Section</h4><p className="text-sm">{amountText}</p></div>
      {value.includesMaterials && hasMaterialCharge(Number(value.materialAmount)) && <div><h4 className="text-xs font-semibold">Parts/Materials Section</h4><p className="text-sm">{quoteMoney(Number(value.materialAmount))}</p></div>}
    </>}
    {value.terms === "diagnostic_service_call" && value.laborAmount.trim() !== "" && <div><h4 className="text-xs font-semibold">Diagnostic/Service Call Fee</h4><p className="text-sm">{amountText}</p></div>}
  </section>;

  return <section aria-label="Quote breakdown" className="space-y-4 rounded-xl border border-border/60 p-4">
    <div className="space-y-1.5"><Label htmlFor={`${id}-terms`}>Quote Terms</Label>
      {/* Parts/Materials exist only for Quoted terms; the save paths drop them for other terms. */}
      <Select value={value.terms} onValueChange={(terms: QuoteFormValue["terms"]) => onChange({ ...value, terms })}>
        <SelectTrigger id={`${id}-terms`}><SelectValue placeholder="Select terms…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="quoted">{QUOTE_TERM_LABELS.quoted}</SelectItem>
          <SelectItem value="free_estimate">{QUOTE_TERM_LABELS.free_estimate}</SelectItem>
          <SelectItem value="diagnostic_service_call">{QUOTE_TERM_LABELS.diagnostic_service_call}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {value.terms === "diagnostic_service_call" && (
      <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold">Diagnostic/Service Call Section</legend>
        <Label htmlFor={`${id}-diagnostic`}>Diagnostic/Service Call Fee ($)</Label>
        <Input id={`${id}-diagnostic`} type="number" min="0" step="0.01" value={value.laborAmount} onChange={(event) => onChange({ ...value, laborAmount: event.target.value })} />
      </fieldset>
    )}
    {value.terms === "quoted" && <>
      <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold">Labor Section</legend>
        <Label htmlFor={`${id}-labor`}>Customer Labor ($)</Label>
        <Input id={`${id}-labor`} type="number" min="0" step="0.01" value={value.laborAmount} onChange={(event) => onChange({ ...value, laborAmount: event.target.value })} />
      </fieldset>
      <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold">Parts/Materials Section</legend>
        <Label htmlFor={`${id}-materials-choice`}>Parts/Materials charges?</Label>
        <Select value={value.includesMaterials ? "yes" : "no"} onValueChange={(choice) => onChange({ ...value, includesMaterials: choice === "yes", materialAmount: choice === "yes" ? value.materialAmount : "" })}>
          <SelectTrigger id={`${id}-materials-choice`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent>
        </Select>
        {value.includesMaterials && <><Label htmlFor={`${id}-materials`}>Parts/Materials ($)</Label>
          <Input id={`${id}-materials`} type="number" min="0.01" step="0.01" value={value.materialAmount} onChange={(event) => onChange({ ...value, materialAmount: event.target.value })} />
        </>}
      </fieldset>
    </>}
  </section>;
}
