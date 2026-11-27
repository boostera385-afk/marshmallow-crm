/**
 * Processor view of a job's techs: Not Texted / Texted / Called per tech (lead_tech_contacts,
 * migration 20261127061449) plus the advisory AI verdict from that tech's Quo chat
 * (`lead-tech-status` Edge Function), merged into one 3-4 word status for the urgent table.
 */

export const TECH_CONTACT_STATES = ["not_texted", "texted", "called"] as const;
export type TechContactState = (typeof TECH_CONTACT_STATES)[number];
export type TechVerdict = "pending" | "agreed" | "declined" | "unclear" | "no_chat";

export interface LeadTechContact {
  id: string;
  lead_id: string;
  tech_number: number;
  name: string;
  phone: string | null;
  state: TechContactState;
  contacted_at: string | null;
  verdict: TechVerdict | null;
  verdict_reason: string | null;
  evidence_quote: string | null;
  evidence_at: string | null;
  verdict_checked_at: string | null;
}

export const TECH_STATE_LABELS: Record<TechContactState, string> = {
  not_texted: "Not Texted",
  texted: "Texted",
  called: "Called",
};

export const TECH_VERDICT_LABELS: Record<TechVerdict, string> = {
  pending: "Waiting",
  agreed: "Agreed",
  declined: "Declined",
  unclear: "Unclear",
  no_chat: "No Quo chat",
};

export type TechSummaryTone = "none" | "idle" | "waiting" | "agreed" | "declined";

export interface TechSummary {
  label: string;
  tone: TechSummaryTone;
  total: number;
  contacted: number;
  agreed: number;
  declined: number;
}

const firstName = (name: string, techNumber: number) => name.trim().split(/\s+/)[0] || `Tech ${techNumber}`;

/** One short status for the whole job, e.g. "Michael, David agreed". */
export function summarizeTechs(techs: LeadTechContact[]): TechSummary {
  const total = techs.length;
  const contacted = techs.filter((tech) => tech.state !== "not_texted");
  const agreed = contacted.filter((tech) => tech.verdict === "agreed").sort((a, b) => a.tech_number - b.tech_number);
  const declined = contacted.filter((tech) => tech.verdict === "declined");
  const base = { total, contacted: contacted.length, agreed: agreed.length, declined: declined.length };

  if (total === 0) return { ...base, label: "No Tech Added", tone: "none" };
  if (contacted.length === 0) return { ...base, label: total === 1 ? "1 tech, not texted" : `${total} techs, not texted`, tone: "idle" };
  if (agreed.length > 0) {
    const names = agreed.map((tech) => firstName(tech.name, tech.tech_number));
    const label = names.length <= 2 ? `${names.join(", ")} agreed` : `${names[0]} +${names.length - 1} agreed`;
    return { ...base, label, tone: "agreed" };
  }
  if (declined.length === contacted.length && contacted.length === total) {
    return { ...base, label: "No tech in area", tone: "declined" };
  }
  const waiting = contacted.length - declined.length;
  if (waiting === 0) {
    // Everyone contacted said no, but some techs are still to be texted.
    return { ...base, label: `${declined.length} declined, text more`, tone: "declined" };
  }
  return { ...base, label: waiting === 1 ? "Waiting on 1 tech" : `Waiting on ${waiting} techs`, tone: "waiting" };
}

export function parseTechContact(row: unknown): LeadTechContact | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.lead_id !== "string" || typeof value.tech_number !== "number") return null;
  if (!(TECH_CONTACT_STATES as readonly string[]).includes(String(value.state))) return null;
  const str = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const verdict = str("verdict");
  return {
    id: value.id,
    lead_id: value.lead_id,
    tech_number: value.tech_number,
    name: str("name") ?? "",
    phone: str("phone"),
    state: value.state as TechContactState,
    contacted_at: str("contacted_at"),
    verdict: verdict && verdict in TECH_VERDICT_LABELS ? (verdict as TechVerdict) : null,
    verdict_reason: str("verdict_reason"),
    evidence_quote: str("evidence_quote"),
    evidence_at: str("evidence_at"),
    verdict_checked_at: str("verdict_checked_at"),
  };
}

/** Badge colours, kept here so component files only export components. */
export const TECH_SUMMARY_TONE_CLASS: Record<TechSummaryTone, string> = {
  none: "border-dashed border-border/70 text-muted-foreground",
  idle: "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  waiting: "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  agreed: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  declined: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

export const TECH_VERDICT_TONE_CLASS: Record<TechVerdict, string> = {
  pending: "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  agreed: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  declined: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300",
  unclear: "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  no_chat: "border-dashed border-slate-400/50 text-muted-foreground",
};
