# Lead contact icons and Tech Status (2026-11-27)

## What it does

### Phase 1: Call / Msg, Incoming / Outgoing
- Every Quo call and text on a lead's linked conversation is recorded in `lead_contact_events`
  (a call counts once, however many `call.*` events Quo sends).
- `lead_first_contacts` holds the lead's first contact: set automatically from the earliest
  event (`source = auto`) or by hand (`source = manual`, never overwritten automatically).
- UI: icon chip next to the date on the lead card (menu: history counts + "Set by hand" for
  Admin / Processor / CS Admin / CS; "Use Quo automatically" clears a manual value) and a
  **Contact** column in the Urgent leads table. Green = outgoing, blue = incoming; phone = call,
  envelope = text. Plain Operators see nothing (they cannot read leads directly).

### Phase 2: Tech Status (Admin and Processor only)
- `lead_tech_contacts` mirrors the "Tech N: name - phone - note" lines in the processor notes
  (trigger on `lead_notes`; notes stay the source of truth for who the techs are).
- Each tech has **Not Texted / Texted / Called** (`set_lead_tech_contact_state` RPC). Moving to
  Texted / Called starts tracking from that moment; back to Not Texted clears it. A changed
  phone number resets the verdict.
- `lead-tech-status` Edge Function reads the tech's **stored** Quo chat (`quo_messages`, matched
  by phone, from 24 h before contact, never before the lead existed) and asks one question: did
  the tech accept or decline THIS job? Rules decide "No Quo chat" and "no reply yet" without AI;
  AI runs only when the tech wrote something new (or on Re-check). Agreed / Declined must quote
  the tech's own words, verified, or it is stored as Unclear. Advisory only.
- Runs: when a tech is marked Texted / Called, from Re-check, from **Refresh AI Status**, and
  every 15 minutes (pg_cron `lead-tech-status`).
- UI: panel at the top of the Processor notes thread, Texted / Called choice in the add-tech
  form, and a **Tech Status** column in the Urgent leads table ("No Tech Added",
  "2 techs, not texted", "Waiting on 2 techs", "Michael, David agreed", "No tech in area",
  "1 declined, text more") with a per-tech popover.

## Apply / deploy (in order)
1. Migration `20261231001100_lead_contact_events.sql` (backfills events and first contacts).
2. Migration `20261231001200_lead_tech_contacts.sql` (backfills techs from processor notes).
3. Deploy Edge Function `lead-tech-status` (needs `OPENAI_API_KEY`; same cron secret as
   `refresh-urgent-statuses`).
4. Migration `20261231001300_lead_tech_status_cron.sql` (15-minute schedule).
5. Regenerate `src/integrations/supabase/types.ts`; then the `as never` casts in
   `src/hooks/useLeadFirstContact.ts` and `src/hooks/useLeadTechContacts.ts` can be removed.
6. Publish the CRM. Donut has no counterpart (no saved-lead cards or urgent table).

## Verification
- Isolated DB harnesses (PGlite, never the shared project):
  `node scripts/test-lead-contact-events-db.mjs <pglite dir>` (27 checks) and
  `node scripts/test-lead-tech-contacts-db.mjs <pglite dir>` (27 checks).
- Unit / component tests: `src/lib/contact-direction.test.ts`, `src/lib/tech-status.test.ts`,
  `src/lib/lead-tech-status-backend.test.ts`, `src/components/leads/FirstContactControl.test.tsx`,
  `src/components/leads/TechTracking.test.tsx`.

## Limits
- Tech chats are read only from Quo messages already stored by the webhook. A tech texted from
  a personal phone shows "No Quo chat"; the processor's Texted / Called state still shows.
- At most 40 AI calls per run; the rest are picked up by the next run.

## Rollback
Each migration ends with a commented rollback block (cron first, then 0900, then 0800).
