import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  DELETE_CHUNK,
  runRetention,
  type ArchivedEvent,
  type RetentionOptions,
  type RetentionStore,
} from "../../supabase/functions/_shared/webhook-event-retention";

const NOW = new Date("2026-11-10T04:07:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** In-memory quo_webhook_events with the same selection rule as the real store. Synthetic rows only. */
function table(rows: ArchivedEvent[], fail: { upload?: number; delete?: boolean } = {}) {
  const live = new Map(rows.map((r) => [r.id, r]));
  const uploads: { path: string; rows: ArchivedEvent[] }[] = [];
  let uploadCalls = 0;
  const store: RetentionStore = {
    async fetchBatch(cutoff, limit) {
      return [...live.values()]
        .filter((r) => ["processed", "ignored"].includes(r.processing_status) && r.received_at < cutoff)
        .sort((a, b) => a.received_at.localeCompare(b.received_at))
        .slice(0, limit);
    },
    async upload(path, body) {
      uploadCalls++;
      if (fail.upload === uploadCalls) throw new Error("storage unavailable");
      uploads.push({ path, rows: gunzipSync(body).toString("utf8").trim().split("\n").map((l) => JSON.parse(l)) });
    },
    async deleteIds(ids) {
      if (fail.delete) throw new Error("database busy");
      let n = 0;
      for (const id of ids) {
        const r = live.get(id);
        if (r && ["processed", "ignored"].includes(r.processing_status)) { live.delete(id); n++; }
      }
      return n;
    },
  };
  return { store, live, uploads };
}

const options = (over: Partial<RetentionOptions> = {}): RetentionOptions => ({
  keepDays: 30, batchSize: 100, maxBatches: 10, now: NOW, runId: "run1",
  gzip: async (text) => new Uint8Array(gzipSync(text)), ...over,
});
const event = (id: string, status: string, ageDays: number): ArchivedEvent =>
  ({ id, processing_status: status, received_at: day(ageDays), raw_payload: { synthetic: id } });

describe("quo_webhook_events retention", () => {
  it("archives then deletes only finished events older than 30 days", async () => {
    const t = table([
      event("old-processed", "processed", 45), event("old-ignored", "ignored", 31),
      event("old-processing", "processing", 60), event("old-failed", "failed", 60),
      event("recent-processed", "processed", 29), event("new", "processed", 1),
    ]);
    const out = await runRetention(t.store, options());
    expect(out).toMatchObject({ archived: 2, deleted: 2, stopped: "done" });
    expect([...t.live.keys()].sort()).toEqual(["new", "old-failed", "old-processing", "recent-processed"]);
    expect(t.uploads.flatMap((u) => u.rows.map((r) => r.id)).sort()).toEqual(["old-ignored", "old-processed"]);
  });

  it("keeps the full row, payload included, in the archive", async () => {
    const t = table([event("a", "processed", 40)]);
    await runRetention(t.store, options());
    expect(t.uploads[0].rows[0]).toEqual(event("a", "processed", 40));
    expect(t.uploads[0].path).toMatch(/^quo_webhook_events\/2026-11-10\/run1-001_2026-10-01_2026-10-01_1\.jsonl\.gz$/);
  });

  it("deletes nothing from a batch whose upload failed, and stops", async () => {
    const t = table(Array.from({ length: 250 }, (_, i) => event(`e${i}`, "processed", 40 + (i % 5))));
    const out = await runRetention(t.store, options({ batchSize: 100 }));
    expect(out.stopped).toBe("done");
    const t2 = table(Array.from({ length: 250 }, (_, i) => event(`e${i}`, "processed", 40)), { upload: 2 });
    const failed = await runRetention(t2.store, options({ batchSize: 100 }));
    expect(failed).toMatchObject({ stopped: "upload_failed", archived: 100, deleted: 100, error: "storage unavailable" });
    expect(t2.live.size).toBe(150); // the second batch was not uploaded, so it was not deleted
  });

  it("leaves rows in place when the delete fails; they are archived again next run", async () => {
    const t = table([event("a", "processed", 40)], { delete: true });
    const out = await runRetention(t.store, options());
    expect(out).toMatchObject({ stopped: "delete_failed", archived: 1, deleted: 0 });
    expect(t.live.has("a")).toBe(true);
  });

  it("works through a backlog in batches and stops at the per-run cap", async () => {
    const t = table(Array.from({ length: 1000 }, (_, i) => event(`e${i}`, "processed", 31 + (i % 50))));
    const out = await runRetention(t.store, options({ batchSize: 300, maxBatches: 2 }));
    expect(out).toMatchObject({ batches: 2, archived: 600, deleted: 600, stopped: "max_batches" });
    expect(t.live.size).toBe(400);
    expect(t.uploads).toHaveLength(2);
  });

  it("keeps going when the API returns fewer rows than asked but more remain", async () => {
    const t = table(Array.from({ length: 2500 }, (_, i) => event(`e${i}`, "processed", 40)));
    const fetch = t.store.fetchBatch.bind(t.store);
    t.store.fetchBatch = async (cutoff) => fetch(cutoff, 1000); // server-side cap below the requested 2,000
    const out = await runRetention(t.store, options({ batchSize: 2000 }));
    expect(out).toMatchObject({ batches: 3, archived: 2500, deleted: 2500, stopped: "done" });
    expect(t.live.size).toBe(0);
  });

  it("deletes in chunks small enough for the request URL", async () => {
    const chunks: number[] = [];
    const t = table(Array.from({ length: DELETE_CHUNK * 2 + 5 }, (_, i) => event(`e${i}`, "processed", 40)));
    const del = t.store.deleteIds.bind(t.store);
    t.store.deleteIds = async (ids) => { chunks.push(ids.length); return del(ids); };
    await runRetention(t.store, options({ batchSize: 1000 }));
    expect(chunks).toEqual([DELETE_CHUNK, DELETE_CHUNK, 5]);
  });

  it("does nothing when there is nothing old enough", async () => {
    const t = table([event("new", "processed", 2)]);
    expect(await runRetention(t.store, options())).toMatchObject({ batches: 0, archived: 0, deleted: 0, stopped: "done" });
    expect(t.uploads).toHaveLength(0);
  });

  it("refuses a window shorter than 7 days", async () => {
    await expect(runRetention(table([]).store, options({ keepDays: 3 }))).rejects.toThrow("Keep at least 7 days");
  });

  it("never acts on an unfinished or recent row even if the store returned one", async () => {
    const t = table([]);
    let deleted: string[] = [];
    t.store.fetchBatch = async () => [event("stuck", "processing", 90), event("young", "processed", 3)];
    t.store.deleteIds = async (ids) => { deleted = ids; return ids.length; };
    const out = await runRetention(t.store, options());
    expect(out.archived).toBe(0);
    expect(deleted).toEqual([]);
  });
});
