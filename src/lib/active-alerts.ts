import { supabase } from "@/integrations/supabase/client";
import { activeNotificationSince } from "@/lib/notification-window";

/**
 * Pop-up alerts (urgent, job in progress, quote updated, incomplete details)
 * read through one batched query: requests made within BATCH_MS by the pop-ups
 * of one tab become a single read of the user's unread alerts of those types in
 * the 3-day window, selected by the server-set `kind` (notification redesign
 * phase 4). Each pop-up still gets at most PER_KIND_LIMIT rows of its own type.
 */
export type PopupAlertKind = "urgent_job" | "job_in_progress" | "quote_updated" | "incomplete_details";

export interface ActiveAlert {
  id: string;
  title: string;
  message: string;
  lead_id: string | null;
  created_at: string;
  read: boolean;
  kind: string | null;
}

export const PER_KIND_LIMIT = 100;
export const BATCH_MS = 25;

interface Waiter {
  kind: PopupAlertKind;
  resolve: (rows: ActiveAlert[]) => void;
  reject: (error: Error) => void;
}
interface Batch {
  since: string;
  startedAt: number;
  waiters: Waiter[];
}
/** A batch whose timer never fired (e.g. the timer was cleared) is abandoned. */
const STALE_BATCH_MS = 1000;
const batches = new Map<string, Batch>();

async function runBatch(userId: string, batch: Batch) {
  const kinds = [...new Set(batch.waiters.map((waiter) => waiter.kind))];
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, message, lead_id, created_at, read, kind")
    .eq("user_id", userId)
    .eq("read", false)
    .in("kind", kinds)
    .gte("created_at", batch.since)
    .order("created_at", { ascending: false })
    .limit(PER_KIND_LIMIT * kinds.length);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ActiveAlert[];
  return new Map(kinds.map((kind) => [kind, rows.filter((row) => row.kind === kind).slice(0, PER_KIND_LIMIT)]));
}

/** Unread alerts of one pop-up type for this user, shared with the other pop-ups' reads. */
export function readActiveAlerts(userId: string, userCreatedAt: string | null | undefined, kind: PopupAlertKind): Promise<ActiveAlert[]> {
  return new Promise((resolve, reject) => {
    let batch = batches.get(userId);
    if (batch && Math.abs(Date.now() - batch.startedAt) > STALE_BATCH_MS) {
      batches.delete(userId);
      batch = undefined;
    }
    if (!batch) {
      const created: Batch = { since: activeNotificationSince(userCreatedAt), startedAt: Date.now(), waiters: [] };
      batches.set(userId, created);
      batch = created;
      setTimeout(() => {
        if (batches.get(userId) === created) batches.delete(userId);
        runBatch(userId, created).then(
          (byKind) => created.waiters.forEach((waiter) => waiter.resolve(byKind.get(waiter.kind) ?? [])),
          (err: unknown) => created.waiters.forEach((waiter) => waiter.reject(err instanceof Error ? err : new Error(String(err)))),
        );
      }, BATCH_MS);
    }
    batch.waiters.push({ kind, resolve, reject });
  });
}

const TITLE_FALLBACK: Record<PopupAlertKind, string> = {
  urgent_job: "urgent job",
  job_in_progress: "job in progress",
  quote_updated: "quote updated",
  incomplete_details: "incomplete details",
};

/** Realtime rows carry `kind`; very old rows only have a title. */
export function isAlertOfKind(row: { kind?: string | null; title?: string | null } | null | undefined, kind: PopupAlertKind) {
  if (!row) return false;
  if (row.kind) return row.kind === kind;
  return Boolean(row.title?.toLowerCase().includes(TITLE_FALLBACK[kind]));
}
