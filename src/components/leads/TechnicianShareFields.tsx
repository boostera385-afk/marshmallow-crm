import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { technicianShareFieldsForTerms, type TechnicianShareField } from "@/lib/quote-breakdown";

export type TechnicianShareValues = Record<TechnicianShareField, string>;

const LABELS: Record<TechnicianShareField, (terms: string, materials: boolean) => string> = {
  for_you_amount: (terms, materials) =>
    terms === "diagnostic_service_call" ? "For You ($ from diagnostic)" : terms === "quoted" && materials ? "For You ($ incl. material)" : "For You ($)",
  for_us_amount: (terms) => (terms === "diagnostic_service_call" ? "For Us ($ from diagnostic)" : "For Us ($ from labor)"),
  for_you_labor_percent: () => "For You (% of labor)",
  for_us_labor_percent: () => "For Us (% of labor)",
  diagnostic_fee_amount: () => "Diagnostic Fee ($)",
};

/**
 * The Internal Technician Share inputs, shown by quote terms (owner formats
 * 2026-11-16): Quoted uses For You / For Us dollars, Free Estimate the labor
 * percentages, Diagnostic/Service Call both; the Diagnostic Fee is on every term.
 * Fields hidden for a term keep their saved values.
 */
export default function TechnicianShareFields({ idPrefix, terms, materialsIncluded = false, values, onChange, readOnly = false, labelClassName, inputClassName }: {
  idPrefix: string;
  terms: string | null | undefined;
  materialsIncluded?: boolean;
  values: TechnicianShareValues;
  onChange: (field: TechnicianShareField, value: string) => void;
  readOnly?: boolean;
  labelClassName?: string;
  inputClassName?: string;
}) {
  return <>
    {technicianShareFieldsForTerms(terms).map((field) => {
      const percent = field.endsWith("_percent");
      const id = `${idPrefix}-${field.replace(/_/g, "-")}`;
      return (
        <div key={field} className="space-y-1.5">
          <Label htmlFor={id} className={labelClassName}>{LABELS[field](terms ?? "", materialsIncluded)}</Label>
          <Input
            id={id}
            type="number"
            min="0"
            max={percent ? "100" : undefined}
            step={percent ? "1" : "0.01"}
            value={values[field]}
            onChange={(event) => onChange(field, event.target.value)}
            placeholder={percent ? "0" : "0.00"}
            className={inputClassName}
            readOnly={readOnly}
          />
        </div>
      );
    })}
  </>;
}
