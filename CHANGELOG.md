# Changelog

Release history for Marshmallow. One entry per **published** release, newest first.
Added by the Admin at the Publish step — see `docs/RELEASE_PROCESS.md`.

Format per entry:

```
## YYYY-MM-DD — <short title>  (PR #<n>)
- What shipped: <plain-language summary>
- Tested by: <Tester name>
- Published by: <Admin name>
```

---

## Unreleased
<!-- Staged on main / preview but not yet Published to users. Move to a dated entry on Publish. -->
- CX/Tech updates, schedule-monitor settings, Copilot settings and Quo webhook ingestion: a stale or
  conflicting save now fails once with its refresh message instead of risking the same endless
  server retry. Needs Edge Functions cx-update-requests, workflow-inbox and marshmallow-copilot
  deployed and the CRM published, then migrations `20261231000400`, `000500` and `000600`.
- Payments: a stale "record payment" no longer makes the server retry it forever (one call
  looped ~once a second for 23 hours on 2026-11-21/22). The user now gets the "Lead status
  changed. Refresh" message once. Needs migration `20261231000300`; no CRM or Donut change.
- AI schedule confirmation: a customer text confirming the schedule moves a Waiting for CX for
  schedule confirmation lead to Ready to schedule (marked AI) and notifies CS, CS Admin, Admin
  and Processor with the job details. Needs migration `20261130000000`, worker deployment and an
  Admin turning it on.
- AI schedule confirmation also starts on our texts, calls, call transcripts and summaries, and
  accepts the customer's words on a call (migration `20261201000000`).
- Donut 1.7.1 (documentation only): the extension's README now matches how Donut works;
  no behavior change. Users only need to reload it when convenient.
- AI urgent features: form-only urgent auto-correction (per-fix Apply/Dismiss, entry gated
  until all fixes resolved), AI status labels + refresh on the Urgent Leads screen (Address
  column removed), and AI cancellation-reason suggestions with a visible approval trail.
  Branch `m.kashif/ai-features`.
