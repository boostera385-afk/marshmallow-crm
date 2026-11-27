/**
 * How a customer was contacted: Call Incoming / Call Outgoing / Msg Incoming / Msg Outgoing.
 *
 * Stored per lead in `lead_first_contacts` (first contact, auto or manual) and per interaction in
 * `lead_contact_events`. Both are written by the database (triggers on Quo messages and the
 * `set_lead_first_contact` RPC); see migration 20261231001100.
 */

export const CONTACT_TYPES = ["call_in", "call_out", "msg_in", "msg_out"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export type ContactKind = "call" | "msg";
export type ContactDirection = "in" | "out";
export type FirstContactSource = "auto" | "manual";

export interface FirstContact {
  lead_id: string;
  contact: ContactType;
  source: FirstContactSource;
  occurred_at: string | null;
  set_by?: string | null;
  updated_at?: string | null;
}

export interface ContactEvent {
  id: string;
  lead_id: string;
  kind: ContactKind;
  direction: ContactDirection;
  occurred_at: string;
}

export const CONTACT_LABELS: Record<ContactType, string> = {
  call_in: "Call Incoming",
  call_out: "Call Outgoing",
  msg_in: "Msg Incoming",
  msg_out: "Msg Outgoing",
};

/**
 * Colour carries the direction (green = we reached out, blue = the customer reached us), the
 * shape carries the channel (phone / envelope), matching the reference icons.
 */
export const CONTACT_TONE: Record<"in" | "out", string> = {
  out: "text-emerald-500 dark:text-emerald-400",
  in: "text-blue-500 dark:text-blue-400",
};

export const CONTACT_CHIP_TONE: Record<"in" | "out", string> = {
  out: "border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15",
  in: "border-blue-500/35 bg-blue-500/10 hover:bg-blue-500/15",
};

export function isContactType(value: unknown): value is ContactType {
  return typeof value === "string" && (CONTACT_TYPES as readonly string[]).includes(value);
}

export function contactType(kind: ContactKind, direction: ContactDirection): ContactType {
  return `${kind}_${direction}` as ContactType;
}

export function splitContactType(type: ContactType): { kind: ContactKind; direction: ContactDirection } {
  const [kind, direction] = type.split("_") as [ContactKind, ContactDirection];
  return { kind, direction };
}

/** A row from the table or realtime payload, or null when it is not a usable first contact. */
export function parseFirstContact(row: unknown): FirstContact | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (typeof value.lead_id !== "string" || !isContactType(value.contact)) return null;
  if (value.source !== "auto" && value.source !== "manual") return null;
  return {
    lead_id: value.lead_id,
    contact: value.contact,
    source: value.source,
    occurred_at: typeof value.occurred_at === "string" ? value.occurred_at : null,
    set_by: typeof value.set_by === "string" ? value.set_by : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
  };
}

/** Counts per type, for the "3 calls · 12 texts" style summary. */
export function summarizeContactEvents(events: ContactEvent[]): Record<ContactType, number> {
  const counts: Record<ContactType, number> = { call_in: 0, call_out: 0, msg_in: 0, msg_out: 0 };
  for (const event of events) {
    const type = contactType(event.kind, event.direction);
    if (type in counts) counts[type] += 1;
  }
  return counts;
}

/** Plain-language title for tooltips and screen readers. */
export function describeFirstContact(contact: FirstContact | null | undefined, when?: string | null): string {
  if (!contact) return "First contact: not recorded yet";
  const how = contact.source === "manual" ? "set by hand" : "from Quo";
  return `First contact: ${CONTACT_LABELS[contact.contact]} (${how}${when ? `, ${when}` : ""})`;
}
