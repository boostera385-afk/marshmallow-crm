# Plan: retention for `quo_webhook_events` (DRAFT, not applied)

Status: **proposal for review. Nothing has been deleted.** Data deletion on the
shared project needs an explicit decision, a backup and a separate migration
(see AGENTS.md, "Database and production safety").

## Why

`public.quo_webhook_events` stores every raw Quo/OpenPhone webhook delivery.
On 2026-11-10 it was the largest table in the database:

| Part | Size |
|---|---|
| Rows (heap) | 269 MB |
| Large payloads (TOAST) | 23 MB |
| Indexes (5) | 65 MB |
| **Total** | **357 MB of a 0.88 GB database (40%)** |

264,598 rows, growing by about 3,000 a day. Rows are kept forever.

Nothing reads old events. The table is used to:
- skip duplicate deliveries (unique `quo_event_id`, and unique `(quo_message_id, event_type)`),
- track each delivery's `processing_status` while the webhook runs,
- delete a conversation's events when an admin deletes the conversation (`quo-admin-controls`).

## Stop first: recover the stuck events (prerequisite)

10,003 events never finished. They are still `processing` (10,002) or
`failed` (1). **These must never be removed by retention.** Their
`raw_payload` is the only copy of what Quo sent.

| Group | Events | What it means |
|---|---|---|
| **2026-11-07, 20:04–23:47 UTC (outage)** | 401 | Customer texts (`message.received`: 99), delivery receipts (127), calls and call summaries/transcripts. Only 14 reached `quo_messages`. |
| **2026-11-09, 13:25–21:46 UTC (outage)** | 500 | Customer texts (`message.received`: 149), delivery receipts (190), calls and call summaries/transcripts. Only 37 reached `quo_messages`. |
| 2026-08-24 – 2026-09-18 | ~9,100 | Only `call.summary.completed` / `call.transcript.completed`, none saved. Looks like an old processing bug for summaries and transcripts, not an outage. |

**About 229 incoming customer texts from the two outages are missing from the CRM's Quo
conversations.** The webhook was cut off (timeouts) after recording the event
as `processing` and before saving the message.

Recommended, as its own reviewed task before any retention:
1. Reprocess the Nov 7 and Nov 9 events from their stored `raw_payload` through the same
   code path the webhook uses (idempotent: messages upsert on `quo_message_id`),
   with ingestion running normally. Report how many messages and calls were recovered.
2. Triage the Aug–Sep summary/transcript group: confirm the old bug is fixed,
   then decide whether to backfill or mark those events `ignored`.
3. Prevent repeats: mark an event `failed` (not leave it `processing`) when the
   function is cut off, and add a small "retry stuck events older than 15 minutes"
   job, guarded by the load governor so it only runs at normal load.

## Proposed retention policy

- **Delete only** events with `processing_status IN ('processed', 'ignored')`
  that were received more than **30 days** ago.
- **Never delete** `processing` or `failed` events (see above).
- Run daily at a quiet hour (for example 04:07 UTC), in batches of 5,000 rows,
  and only while the load governor reports `normal`.

Effect today:

| Window | Rows removed now | Share of rows |
|---|---|---|
| 30 days (proposed) | 164,672 | 62% |
| 60 days | 75,350 | 28% |

## What this will and will not do

- **Will:** stop the table growing (old space is reused by new rows), shrink its
  indexes over time, and keep backups and disk smaller.
- **Will not, on its own:** shrink the file on disk. PostgreSQL reuses the space;
  returning it needs a one-time `VACUUM FULL`, which locks the table and
  blocks webhook inserts for a short time. If wanted: run it in a quiet window
  with Quo ingestion paused (the existing ingestion pause control). Quo retries
  deliveries it could not complete.
- **Not an outage fix.** The table is written, not read, during normal use. The
  memory benefit is limited to its index pages. The outages are addressed
  by the compute upgrade and the query, realtime and governor changes of
  2026-11-10.

## Risks

| Risk | Assessment |
|---|---|
| A retried delivery of an event deleted after 30 days is processed twice | Quo retries for a short period, not weeks. Messages also upsert on `quo_message_id`, so a duplicate would not create a second message. Negligible. |
| Losing raw payloads needed later (disputes, audits, debugging) | Real. Mitigated by exporting before the first deletion (below). |
| Deleting stuck events that hold unrecovered messages | Excluded by the status filter. Covered by tests. |
| Load from the first large delete | Batched, quiet hours, governor-gated. |

## Backup before the first deletion

Supabase's automatic backups are short-lived. Before the first run, export the
rows that will be deleted (`processed`/`ignored`, older than 30 days) to a file you keep, such as
JSON lines in private storage or a download. After that, each daily run removes only one day's
worth (~3,000 rows), already covered by the export window if repeated monthly,
or accepted as disposable.

## Decisions needed from you

1. The retention window: 30 days (recommended), 60 or 90.
2. Export before deleting: yes (recommended), and where to keep it.
3. Reprocessing the Nov 7 and Nov 9 stuck events first: yes (recommended).
4. A one-time `VACUUM FULL` in a quiet window with ingestion paused: optional.

## Draft SQL (for review only, do not apply)

This would become `supabase/migrations/<timestamp>_quo_webhook_events_retention.sql`
with a harness, after the decisions above.

```sql
CREATE OR REPLACE FUNCTION marshmallow_private.purge_quo_webhook_events(
  p_keep_days integer DEFAULT 30, p_batch integer DEFAULT 5000, p_max_batches integer DEFAULT 40)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE removed integer := 0; n integer; i integer := 0;
BEGIN
  IF p_keep_days < 7 THEN RAISE EXCEPTION 'keep at least 7 days' USING errcode = '22023'; END IF;
  WHILE i < p_max_batches AND marshmallow_private.current_load_level() = 'normal' LOOP
    DELETE FROM public.quo_webhook_events
     WHERE id IN (
       SELECT id FROM public.quo_webhook_events
        WHERE processing_status IN ('processed', 'ignored')   -- never processing / failed
          AND received_at < now() - make_interval(days => p_keep_days)
        ORDER BY received_at
        LIMIT p_batch);
    GET DIAGNOSTICS n = ROW_COUNT;
    removed := removed + n;
    EXIT WHEN n < p_batch;
    i := i + 1;
  END LOOP;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.purge_quo_webhook_events(integer, integer, integer) FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('quo-webhook-events-retention', '7 4 * * *',
  'SELECT marshmallow_private.purge_quo_webhook_events(30)');
```

## How it would be verified

- Before and after: row counts per `processing_status` and age bucket. Every `processing`
  and `failed` row is still present.
- A harness on a throwaway database. It seeds every status and age and asserts only
  old `processed`/`ignored` rows are removed, that batching stops at a normal level, and the
  7-day guard.
- After the first run: the webhook still answers 2xx and new messages appear in the CRM.
