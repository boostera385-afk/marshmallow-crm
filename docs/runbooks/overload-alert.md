# Overload alert: what it means and what to do

Added 2026-11-10 after the outages of Nov 7 and Nov 9, when the database host ran out
of memory (swap grew to almost the size of RAM, IO wait ~88%) and the CRM stopped.

## How it works

- Every minute, the Edge Function `system-health-watch` reads the database host's
  memory, swap, CPU, IO wait and disk from Supabase's Metrics API. It passes them to
  `public.record_system_health()` (migration `20261210040000_system_health_alerts.sql`).
- The database adds the load governor's view: how busy queries keep the database, and
  how many connections are in use. It then decides the level:

| Level | When | Meaning |
|---|---|---|
| **Warning** (amber) | a warning reading holds for 3 minutes in a row | Still recoverable. Act now. |
| **Critical** (red) | a critical reading holds for 2 minutes in a row | This is close to the Nov 7/9 outage pattern. |
| **Back to normal** (green) | every reading is below warning for 10 minutes | Nothing to do. |

- Each change of level goes to every Admin as a corner card in the CRM (it doesn't
  block work) and as an email.
- While the level stays raised, a reminder comes every 30 minutes at critical and
  every 60 minutes at warning.

## Starting thresholds

The thresholds live in `marshmallow_private.health_policy` and can be changed there.

| Reading | Warning | Critical |
|---|---|---|
| Memory available | ≤ 20% | ≤ 10% |
| Swap used (as % of RAM) | ≥ 25% **and** up 2+ points in 10 min | ≥ 60% |
| IO wait | ≥ 15% | ≥ 40% |
| CPU busy | ≥ 70% | ≥ 90% |
| Database connections | ≥ 70% of the limit | ≥ 90% |
| Disk used | ≥ 80% | ≥ 90% |
| Load governor | elevated | critical |

"Memory commitment" on the Supabase dashboard is **not** used. It reads about 96% even
when everything is fine, so it would alert all the time.

## What to do

1. The alert names the people with the most live connections. More connections means
   more open CRM tabs. Ask them to close extra tabs, then wait 2 minutes.
2. Avoid exports, bulk syncs and the Supabase dashboard's Query Performance page until
   it clears.
3. If Quo webhooks are piling up, pause Quo ingestion with the existing control.
4. If it is **critical** and does not ease within 10 minutes, or a warning lasts 30
   minutes, upgrade compute in Supabase → Settings → Compute.

## Other notices

- **"Overload alert cannot read memory metrics"** (at most once a day): the Metrics API
  refused or failed. The alert still watches database load and connections, but not
  memory.
  - It never treats missing numbers as "fine": the level does not step down while
    they are missing.
  - Check the function's secret key. You can set `HEALTH_METRICS_KEY` to a secret
    key (`sb_secret_…`).
- **"Overload alert email is not set up"** (at most once a day, only when an alert was
  raised): add the Edge Function secrets `RESEND_API_KEY` and `HEALTH_ALERT_EMAILS`
  (comma-separated). `HEALTH_ALERT_FROM` is optional. Without a verified domain, Resend
  sends from `onboarding@resend.dev`, and only to the Resend account's own email.
- **If the database itself cannot be reached**, the function still emails a critical
  alert when the host shows the outage pattern, at most every 10 minutes.

## Settings and tests

Run these in the SQL Editor:

```sql
-- Pause alerts (still records samples)
UPDATE marshmallow_private.health_policy SET enabled = false;

-- Change a threshold
UPDATE marshmallow_private.health_policy SET cpu_warn_pct = 75;

-- Last hour of readings
SELECT * FROM marshmallow_private.health_samples ORDER BY sampled_at DESC LIMIT 60;
```

- **Test alert:** call the function with body `{"test_level":"warning"}`. It is labelled
  `[Test]` and leaves the stored level unchanged.
- **Dry run:** body `{"dry_run":true}` records a minute without notifying anyone.
- **Harness:** `supabase/tests/172_system_health_isolated.sql`, run on a throwaway local
  database only.
