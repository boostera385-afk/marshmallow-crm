/**
 * Quick Chat button status, computed from the batched quo_conversations read the
 * buttons already share (no extra request per button).
 */
export interface QuickChatConversationRow {
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  last_message_at: string | null;
  isTechLine: boolean;
}

export interface QuickChatStatus {
  /** The customer (or technician) sent the last message. */
  fromContact: boolean;
  /** Time of the last message in this chat, whoever sent it; null when unknown. */
  lastMessageAt: string | null;
}

const time = (value: string | null | undefined) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * `rows` are the contact's conversations, newest first. The unread dot keeps its
 * existing fallback to the newest conversation; the time is only shown for a
 * conversation on the button's own line (CX vs Tech), so a Tech button never
 * shows the customer line's time.
 */
export function quickChatStatus(rows: QuickChatConversationRow[], chatType: "customer" | "tech" | undefined): QuickChatStatus {
  const wantsTech = chatType === "tech";
  const ownLine = rows.find((row) => row.isTechLine === wantsTech) ?? null;
  const match = ownLine ?? rows[0] ?? null;
  const customerAt = time(match?.last_customer_message_at);
  const agentAt = time(match?.last_agent_message_at);
  const latest = ownLine
    ? Math.max(time(ownLine.last_message_at), time(ownLine.last_customer_message_at), time(ownLine.last_agent_message_at))
    : 0;
  return {
    fromContact: customerAt > 0 && customerAt > agentAt,
    lastMessageAt: latest > 0 ? new Date(latest).toISOString() : null,
  };
}

/** The later of the batched time and the open thread's newest message. */
export function latestChatTime(...values: (string | null | undefined)[]): string | null {
  const latest = Math.max(0, ...values.map(time));
  return latest > 0 ? new Date(latest).toISOString() : null;
}
