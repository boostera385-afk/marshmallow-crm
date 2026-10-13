import { useState } from "react";
import { PauseCircle, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import CompleteLeadCopyButton from "@/components/leads/CompleteLeadCopyButton";
import { HOLD_REASON_LABELS, type HoldAlert } from "@/lib/operator-workflow";

interface Props { alert: HoldAlert; onAcknowledge: (alert: HoldAlert) => void; saving?: boolean; expanded?: boolean }
export default function HoldJobCard({ alert, onAcknowledge, saving = false, expanded = false }: Props) {
  const [open, setOpen] = useState(expanded);
  const lead = alert.snapshot;
  const rows = [
    ["Customer", lead.customer_name], ["Phone", lead.customer_phone], ["Landline", lead.customer_landline],
    ["Service", lead.service_type], ["Service Details", lead.service_details], ["Address", lead.address],
    ["Location", [lead.city, lead.state, lead.zip_code].filter(Boolean).join(", ")],
    ["Schedule Requirement", lead.customer_schedule_requirements],
    ["Scheduled For", [lead.scheduled_date, lead.scheduled_time_start, lead.scheduled_time_end].filter(Boolean).join(" · ")],
    ["Quote", lead.quote], ["Technician", [lead.tech_name, lead.tech_number].filter(Boolean).join(" · ")],
  ].filter(([, value]) => Boolean(value));
  return (
    <article className="rounded-2xl border border-slate-300 bg-slate-100 p-4 text-slate-900 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" aria-label={`Hold This Job ${lead.job_id}`}>
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 h-6 w-6 shrink-0 text-slate-600 dark:text-slate-300" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Hold This Job</h3>
          <p className="break-words text-sm font-medium">{lead.job_id} · {lead.customer_name}</p>
          <p className="mt-1 text-sm">Urgent Job → {HOLD_REASON_LABELS[alert.reason]}</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Stop working this job. The saved status and customer schedule are unchanged by this alert.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Hide details" : "Complete card"}<ChevronDown className={`ml-1 h-3 w-3 ${open ? "rotate-180" : ""}`} />
        </Button>
        {!alert.read && <Button size="sm" variant="secondary" disabled={saving} onClick={() => onAcknowledge(alert)}>
          <Check className="mr-1 h-3 w-3" />{saving ? "Acknowledging…" : "Acknowledge"}
        </Button>}
        {alert.read && <span className="self-center text-xs">Acknowledged</span>}
      </div>
      {open && <div className="mt-3 space-y-3 border-t border-slate-300 pt-3 dark:border-slate-600">
        <dl className="space-y-2">{rows.map(([label, value]) => <div key={label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm">{value}</dd>
        </div>)}</dl>
        <CompleteLeadCopyButton lead={lead} className="w-full" />
        <p className="text-[11px] text-slate-600 dark:text-slate-300">Read-only snapshot at {new Date(alert.created_at).toLocaleString()}. Private notes and photos are not copied into notifications.</p>
      </div>}
    </article>
  );
}
