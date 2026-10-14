import { useState } from "react";
import { PauseCircle, ChevronDown, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import CompleteLeadCopyButton from "@/components/leads/CompleteLeadCopyButton";
import { HOLD_REASON_LABELS, type HoldAlert } from "@/lib/operator-workflow";

interface Props {
  alert: HoldAlert;
  onAcknowledge: (alert: HoldAlert) => void;
  onDismiss?: (alert: HoldAlert) => void;
  saving?: boolean;
  expanded?: boolean;
}
export default function HoldJobCard({ alert, onAcknowledge, onDismiss, saving = false, expanded = false }: Props) {
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
    <article className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card p-4 text-card-foreground shadow-xl" aria-label={`Hold This Job ${lead.job_id}`}>
      <div className="absolute inset-x-0 top-0 h-1 bg-[var(--gradient-brand)]" />
      <div className="flex items-start gap-3 pt-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <PauseCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Operator alert</p>
          <h3 className="font-semibold text-foreground">Hold This Job</h3>
          <p className="break-words text-sm font-medium">{lead.job_id} · {lead.customer_name}</p>
          <p className="mt-1 text-sm text-foreground">Urgent Job → {HOLD_REASON_LABELS[alert.reason]}</p>
          <p className="mt-1 text-xs text-muted-foreground">Stop working this job. The saved status and customer schedule are unchanged by this alert.</p>
        </div>
        {onDismiss && <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Hide hold notification for ${lead.job_id}`} onClick={() => onDismiss(alert)}><X className="h-4 w-4" /></button>}
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
      {open && <div className="mt-3 space-y-3 border-t border-border pt-3">
        <dl className="space-y-2">{rows.map(([label, value]) => <div key={label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm">{value}</dd>
        </div>)}</dl>
        <CompleteLeadCopyButton lead={lead} className="w-full" />
        <p className="text-[11px] text-muted-foreground">Read-only snapshot at {new Date(alert.created_at).toLocaleString()}. Private notes and photos are not copied into notifications.</p>
      </div>}
    </article>
  );
}
