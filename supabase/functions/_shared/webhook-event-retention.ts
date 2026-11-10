// =============================================================================
// 30-day retention for quo_webhook_events, export first.
//
// quo_webhook_events is the raw delivery log of Quo webhooks (not the messages
// shown in the CRM - those live in quo_messages and are never touched here).
// Each run:
//   1. reads a batch of the oldest rows that finished processing
//      (processed / ignored) and were received before the cutoff,
//   2. uploads them as gzipped JSON lines to the private "archives" bucket,
//   3. deletes exactly those ids - and only if the upload succeeded - again
//      restricted to processed / ignored.
// Rows still "processing" or "failed" are never selected or deleted.
// =============================================================================

export const RETENTION_STATUSES = ["processed", "ignored"] as const;
export const MIN_KEEP_DAYS = 7;
/** Ids per DELETE request (keeps the in.(...) filter well inside URL limits). */
export const DELETE_CHUNK = 200;

export interface ArchivedEvent {
  id: string;
  received_at: string;
  processing_status: string;
  [column: string]: unknown;
}

export interface RetentionStore {
  fetchBatch(cutoffIso: string, limit: number): Promise<ArchivedEvent[]>;
  upload(path: string, body: Uint8Array): Promise<void>;
  deleteIds(ids: string[]): Promise<number>;
}

export interface RetentionOptions {
  keepDays: number;
  batchSize: number;
  maxBatches: number;
  now: Date;
  runId: string;
  gzip: (text: string) => Promise<Uint8Array>;
}

export interface RetentionResult {
  cutoff: string;
  batches: number;
  archived: number;
  deleted: number;
  files: string[];
  stopped: "done" | "max_batches" | "upload_failed" | "delete_failed";
  error?: string;
}

export function toJsonLines(rows: readonly ArchivedEvent[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function archivePath(now: Date, runId: string, batch: number, rows: readonly ArchivedEvent[]): string {
  const day = now.toISOString().slice(0, 10);
  const first = rows[0]?.received_at.slice(0, 10) ?? "empty";
  const last = rows[rows.length - 1]?.received_at.slice(0, 10) ?? "empty";
  return `quo_webhook_events/${day}/${runId}-${String(batch).padStart(3, "0")}_${first}_${last}_${rows.length}.jsonl.gz`;
}

export async function runRetention(store: RetentionStore, options: RetentionOptions): Promise<RetentionResult> {
  if (!Number.isInteger(options.keepDays) || options.keepDays < MIN_KEEP_DAYS) {
    throw new Error(`Keep at least ${MIN_KEEP_DAYS} days.`);
  }
  const cutoff = new Date(options.now.getTime() - options.keepDays * 86_400_000).toISOString();
  const result: RetentionResult = { cutoff, batches: 0, archived: 0, deleted: 0, files: [], stopped: "done" };

  while (result.batches < options.maxBatches) {
    const rows = (await store.fetchBatch(cutoff, options.batchSize))
      // Belt and braces: never act on a row that is not finished or not old enough.
      .filter((row) => (RETENTION_STATUSES as readonly string[]).includes(row.processing_status) && row.received_at < cutoff);
    if (rows.length === 0) return result;

    const path = archivePath(options.now, options.runId, result.batches + 1, rows);
    try {
      await store.upload(path, await options.gzip(toJsonLines(rows)));
    } catch (error) {
      return { ...result, stopped: "upload_failed", error: error instanceof Error ? error.message : "upload failed" };
    }
    result.files.push(path);
    result.archived += rows.length;
    result.batches++;

    const ids = rows.map((row) => row.id);
    try {
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        result.deleted += await store.deleteIds(ids.slice(i, i + DELETE_CHUNK));
      }
    } catch (error) {
      // Rows that were not deleted stay in the table and are archived again next run.
      return { ...result, stopped: "delete_failed", error: error instanceof Error ? error.message : "delete failed" };
    }
    // Keep going until a read comes back empty: the API may return fewer rows
    // than asked (PostgREST caps responses at 1,000) even when more remain.
  }
  return { ...result, stopped: "max_batches" };
}
