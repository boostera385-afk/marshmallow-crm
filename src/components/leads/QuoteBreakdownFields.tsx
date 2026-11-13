import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasMaterialCharge, quoteMoney, type QuoteFormValue } from "@/lib/quote-breakdown";

export default function QuoteBreakdownFields({ value, onChange, readOnly = false }: {
  value: QuoteFormValue;
  onChange: (value: QuoteFormValue) => void;
  readOnly?: boolean;
}) {
  const id = useId();
  if (readOnly) return <section aria-label="Quote breakdown" className="space-y-3 rounded-xl border border-border/60 p-4">
    <h3 className="text-sm font-semibold">Quote</h3>
    <p className="text-sm">{value.terms === "quoted" ? "Quoted" : value.terms === "free_estimate" ? "Free Estimate Visit" : "Terms not recorded"}</p>
    {value.terms === "quoted" && <>
      <div><h4 className="text-xs font-semibold">Labor Section</h4><p className="text-sm">{value.laborAmount.trim() && Number.isFinite(Number(value.laborAmount)) ? quoteMoney(Number(value.laborAmount)) : "Not recorded"}</p></div>
      {value.includesMaterials && hasMaterialCharge(Number(value.materialAmount)) && <div><h4 className="text-xs font-semibold">Parts/Materials Section</h4><p className="text-sm">{quoteMoney(Number(value.materialAmount))}</p></div>}
    </>}
  </section>;

  return <section aria-label="Quote breakdown" className="space-y-4 rounded-xl border border-border/60 p-4">
    <div className="space-y-1.5"><Label htmlFor={`${id}-terms`}>Quote Terms</Label>
      <Select value={value.terms} onValueChange={(terms: QuoteFormValue["terms"]) => onChange({ ...value, terms })}>
        <SelectTrigger id={`${id}-terms`}><SelectValue placeholder="Select terms…" /></SelectTrigger>
        <SelectContent><SelectItem value="quoted">Quoted</SelectItem><SelectItem value="free_estimate">Free Estimate Visit</SelectItem></SelectContent>
      </Select>
    </div>
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
