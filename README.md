<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=30&pause=2500&center=true&width=760&height=56&lines=Internal+CRM+for+home+services&color=38BDF8" alt="Marshmallow CRM" />

<br/>

<img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18"/>
<img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
<img src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite"/>
<img src="https://img.shields.io/badge/Tailwind-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/>
<img src="https://img.shields.io/badge/shadcn%2Fui-Radix-000000?style=for-the-badge&logo=radixui&logoColor=white" alt="shadcn/ui"/>

<br/>

<img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth%20%2B%20RLS-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"/>
<img src="https://img.shields.io/badge/TanStack_Query-v5-FF415C?style=for-the-badge&logo=tanstack&logoColor=white" alt="TanStack Query"/>
<img src="https://img.shields.io/badge/Edge_Functions-11-8B5CF?style=for-the-badge&logo=supabase&logoColor=white" alt="Edge Functions"/>
<img src="https://img.shields.io/badge/Role_Based_Access-6_roles-F59E0B?style=for-the-badge&logo=lucide&logoColor=black" alt="RBAC"/>

<br/>

<img src="https://img.shields.io/badge/migrations-176-2563EB?style=for-the-badge&logo=supabase&logoColor=white" alt="176 migrations"/>
<img src="https://img.shields.io/badge/unit_tests-27_files%20%C2%B7%20291_passing-16A34A?style=for-the-badge&logo=vitest&logoColor=white" alt="291 tests passing"/>
<img src="https://img.shields.io/badge/db_harnesses-9_SQL-CFA874?style=for-the-badge&logo=postgresql&logoColor=white" alt="SQL harnesses"/>
<img src="https://img.shields.io/badge/lead_statuses-25-9333EA?style=for-the-badge&logo=postgresql&logoColor=white" alt="25 lead statuses"/>

</div>

---

## About

**Marshmallow** is an internal, role-gated lead-management CRM for a home-services
business. It carries a lead from first contact through quoting, scheduling, job
execution and payment approval, and mirrors the Quo/OpenPhone chat inbox so calls and
texts stay attached to the record they belong to.

Everything is permission-driven at **five layers** — UI, frontend permission helpers,
database RLS, Edge Functions, and generated types. A role change is not done until all
five agree.

**Copilot pilot:** the `pilot` branch adds a read-only operational workspace, saved
lead/daily work briefs, conversational filters and explicitly consented AI drafting,
with Admin readiness and stale-setting protection. Its backend is installed and
types regenerated; CRM publication and real signed-in/provider QA remain separate; see
[Copilot rollout](docs/COPILOT_ROLLOUT.md). No AI action approves or sends anything.

> **Note on "Quo AI"** — the earlier Quo AI layer was removed in migration
> `20260811082959`; Quo remains a webhook-driven chat mirror. Marshmallow Copilot is a
> separate, read-only assistant with deterministic CRM tools and optional bounded AI,
> not a restoration of that legacy layer. Its migration, deployment and pilot rollout
> are separate approval steps: see [Copilot rollout](docs/COPILOT_ROLLOUT.md).

---

## Table of Contents

- [What it does](#what-it-does)
- [Application surface](#application-surface)
- [Roles and permissions](#roles-and-permissions)
- [Lead lifecycle](#lead-lifecycle)
- [Tech stack](#tech-stack)
- [Database](#database)
- [Edge Functions](#edge-functions)
- [Quo and OpenPhone integration](#quo-and-openphone-integration)
- [Architecture notes](#architecture-notes)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Testing](#testing)
- [Migration workflow](#migration-workflow-important)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Technical debt](#technical-debt)
- [House rules](#house-rules)

---

## What it does

| Area | Capability |
|---|---|
| **Lead pipeline** | 25-status pipeline with role-scoped visibility, per-user overrides, lead tags, pinning and priority ordering |
| **Quoting** | Quote approval workflow (request-before-send gate), quotes-to-send queue, quotation-master permissions, incomplete-details flags |
| **Payments** | Payment approval queue with evidence capture; a `paid` lead becomes immutable once set |
| **Cancellations** | Cancellation request/approval workflow with proof-image upload |
| **Technicians** | Directory with import/delete rules, ownership scoping, OPR assignment, Good Tech flag, and Processing Workflow with Quo chat assessment |
| **Reporting** | Per-technician paid performance, OPR report, area insights, optimisation |
| **Optimization** | Areas ranked on jobs that closed in them; mark an area to track its outcome |
| **Scheduling** | Schedule board, free-text schedule-requirement parsing, due/overdue detection |
| **Map** | Leaflet map view, coverage areas, nearby-urgent clustering, and nearby technician multi-select for workflow reports |
| **Chat** | Quo/OpenPhone conversation mirror with a triage status axis and per-lead chat |
| **Admin** | User management, access codes, TOTP status, activity logs, in-app system documentation |
| **Copilot** | Permission-aware header / Ctrl+K assistant, feature guides, scoped lead and technician searches, personal/team reports, measured health and optional budgeted AI; Admin-only and AI-off defaults |
| **Realtime** | ~24 Supabase Realtime channels with React Query cache invalidation |
| **Audit** | Activity log writes on mutations, with denormalised actor names |

---

## Application surface

Navigation is grouped and filtered per role. Items can be granted per user through
`navigation_permissions`, except the ones hard-locked to Admin.

<details>
<summary><b>Expand full route table</b></summary>

| Route | Page | Guard |
|---|---|---|
| `/leads` | Leads list | `leads` |
| `/leads/:id` | Lead detail | `leads` |
| `/schedule` | Schedule board | `schedule` |
| `/map-view` | Map view | `map_view` |
| `/analytics` | Analytics | `analytics` |
| `/areas` | Area insights | `areas` |
| `/technicians` | Technicians (Directory / OPR Report / Tech Report) | `technicians` |
| `/optimization` | Optimization | **Admin only** (locked in UI *and* RLS) |
| `/lead-cancellation-requests` | Cancellation approvals | admin, processor |
| `/lead-payment-requests` | Payment approvals | **Admin only** |
| `/quote-approval` | Quote approval queue | grantable |
| `/quote-pending` | Quotes to send | admin or `is_quotation_master` |
| `/quo-monitor`, `/quo-dashboard` | Quo inbox | `quo_monitor` |
| `/activity-logs` | Activity logs | admin default |
| `/settings` | Settings / Users / Documentation | admin, or CS Admin with `can_manage_users` |

</details>

Sidebar groups: **Work** · **Review** · **Manage** · **Insights** · **Admin**, plus a
dynamic **By Status** group and a **Need Attention** virtual view for urgent leads whose
schedule requirements are due or overdue.

---

## Roles and permissions

Six roles. The role lives in its own `user_roles` table — never on the profile row.

| Role | Purpose |
|---|---|
| `admin` | Full access; bypasses every navigation check |
| `cs_admin` | Customer-service lead, can manage CS users when `can_manage_users` is set |
| `customer_service` | First-line lead handling, quoting, communication |
| `processor` | Scheduling, dispatch, cancellation approvals, technicians |
| `opr` | Out-of-plan representative; read-only, scoped to assigned leads |
| `opr_admin` | OPR with additional technician visibility |

<details>
<summary><b>Per-user flags (independent of role)</b></summary>

| Flag | Grants |
|---|---|
| `is_quotation_master` | Quotes-to-send queue; excluded for CS Admin by design |
| `can_manage_users` | Lets `cs_admin` reach Settings → Users |
| `can_add_manual_leads` | Unlocks the manual New Lead button and `⌘N` |
| `can_view_tech_report` | Unlocks the Technician Report tab |
| `opr_code` | Immutable code used to scope which technicians an OPR sees |

</details>

**Two independent status axes.** *Visibility* controls which statuses a role can read
and is overridable per user through `lead_status_visibility`. *Change access*
(`STATUS_CHANGE_ACCESS`) controls which statuses a role may set — and currently allows
`opr` / `opr_admin` **no** status changes at all.

---

## Lead lifecycle

`waiting_complete_details` → `urgent_job` → `needs_quote` / `tech_making_quote` →
`quote_sent_waiting` → `need_tech` → `scheduled` → `job_in_progress` → `job_done` →
`payment_pending` → `payment_requested` → `paid`

Alongside the main path: `partial_paid`, `cancelled`, `cancellation_requested`,
`needs_reschedule`, `post_visit_confirmation`, `activate_customer`,
`post_visit_quote_sent_waiting`, `quote_sent_need_follow_up`, `waiting_customer_response`,
`quote_change`, `scammed`, `pending_to_send`, `quote_updated`.

Terminal rule enforced by trigger `enforce_paid_status_rules`: once a lead is `paid` it
can never change status again, and only Admin or `service_role` may move a lead *into*
`paid`.

---

## Tech stack

| Layer | Choice |
|---|---|
| Build | Vite 5 + `@vitejs/plugin-react-swc` |
| UI | React 18, TypeScript 5.8 |
| Components | shadcn/ui on Radix primitives (48 vendored components) |
| Styling | Tailwind CSS 3 with HSL tokens, `tailwindcss-animate` |
| Motion | Framer Motion (tokens in `src/lib/motion.ts`) |
| Icons | lucide-react |
| Data | TanStack Query v5 |
| Forms | React Hook Form + Zod + `@hookform/resolvers` |
| Backend | Supabase — Postgres, Auth, RLS, Storage, Realtime, Edge Functions (Deno) |
| Maps | Leaflet + `react-leaflet`, local ZIP-centroid dataset |
| Charts | Recharts |
| Export | jsPDF, SheetJS (`xlsx`) |
| Notifications | Sonner + Radix toast |
| Tests | Vitest (jsdom) + Testing Library; SQL harnesses for RLS |

---

## Database

**156 migrations** in `supabase/migrations/`, timestamp-named, most with header comments
explaining the defect being fixed. Later migrations are semantically named.

### Key RPCs

| Function | Purpose |
|---|---|
| `parse_lead_location(address, city, state, zip)` | Shared resolver — strips invisible characters, then derives city/state/ZIP |
| `area_performance(state)` | Jobs in an area by status |
| `area_leaderboard(limit)` | Areas ranked on jobs that closed; Admin only |
| `optimized_areas_with_performance()` | Marked areas plus live outcomes |
| `tech_paid_performance()` | Per-technician paid aggregates; Admin only |
| `get_lead_status_counts()` | Status counts for the list header |
| `can_create_manual_lead()` | Manual-lead gate, replacing a permissive check |
| `has_role(user, role)` | Role lookup used across RLS policies |
| `leads_owned_by_caller()` | Visibility helper for the consolidated leads policy |
| `delete_lead_by_admin()` | Admin-only lead deletion |

### Security posture

Row Level Security is consolidated rather than layered — overlapping `SELECT` policies
were merged into one role-based policy with a helper function, closing a path where a
CS Admin could read leads outside their scope. Visibility for every role was verified
against live data before and after the change.

---

## Edge Functions

11 Deno functions under `supabase/functions/`:

| Function | Purpose |
|---|---|
| `quo-webhook` | Primary Quo/OpenPhone webhook receiver; verifies signature, upserts conversations and messages |
| `quo-message-webhook` | Second webhook receiver for message events |
| `quo-reconcile-sync` | Incremental safety-net backfill from the Quo API |
| `quo-sync-contacts` | Upserts contact names and numbers onto conversations |
| `quo-sync-history` | Backfills message history for one conversation |
| `quo-admin-controls` | Admin-only pause/resume ingestion and deletion |
| `admin-users` | Admin-only user API — create, set password, delete (cascades ~18 tables), TOTP |
| `generate-nearby-areas` | Geocodes an address and returns top nearby populated places |
| `google-sheets-sync` | Admin-protected Sheets proxy, transactional outbox worker, and full-reconcile controller |
| `sync-us-places` | Syncs Census places and ACS population into `us_places` |
| `check-urgent-lead` | Compares a lead against the customer's conversation before it goes urgent (`gpt-4o-mini`) |
| `technician-chat-assessment` | Admin/Processor-only report over selected technicians' latest Quo messages; returns advisory labels and job counts |

### `check-urgent-lead`

Reads the **stored** lead and the matching Quo conversation, then reports only
the things that contradict each other. The client sends a lead id and nothing
else — accepting the browser's copy of the record would mean verifying whatever
was claimed rather than what was saved.

Three outcomes, and the difference matters:

| Outcome | Meaning | Effect |
|---|---|---|
| `checked`, no issues | Nothing contradicts the conversation | Proceeds. No second click. |
| `checked`, issues | Genuine disagreements, each with the customer's own words | Goes to a CS Admin |
| `unavailable` | Nothing could be compared (no conversation, no text, timeout) | Needs a deliberate acknowledgement |

`unavailable` is deliberately not one of the other two. It applies to **44% of
leads**, which have no matched conversation. Reporting it as a finding would send
nearly half of all urgent work to a human queue permanently, and a queue that is
mostly noise stops being read. Reporting it as clean would claim a check that
never ran. It gets its own state, and the activity log records it as
`urgent_unverified_acknowledged` — never as a passed check.

The conversation is looked up by `quo_conversations.linked_lead_id` first, then
by phone. `linked_lead_id` is currently `NULL` on all ~18,400 conversations, so
phone is what actually matches today, and it needs normalising: leads store
`(904) 844-5483` while conversations store `+12056010689`.

**The result is advisory.** It sets nothing. A clean result is a suggestion that
nothing contradicts the record; the CS member still submits, and issues still go
to a CS Admin. The database trigger is what enforces the rule, which is what
keeps the worst outcome of a wrong or manipulated result at "misleading
suggestion" rather than "unauthorised status change".

Transcript text is untrusted input — a customer can type anything, including
something shaped like an instruction to the model. It is fenced, labelled as
data, and the checks are about comparing a record to a conversation, so an
injected instruction can at worst produce a wrong opinion about that comparison.

**Required secret:** `OPENAI_API_KEY` (Edge Functions → Secrets). Set it as a
project secret, never in a `VITE_` variable.

> The checks are written against the shape the data actually has, measured across
> the 133 existing urgent leads: `scheduled_date` is null in 95%, `terms` is null
> in 58% (and all of those still carry quote text), and the schedule lives in
> `customer_schedule_requirements` free text in 93%. The literal checks "if
> `scheduled_date` conflicts" and "`terms` must be quoted or free_estimate" would
> have been near-vacuous on 95% of leads and wrong on 58% of them.

---

## Quo and OpenPhone integration

Quo (formerly OpenPhone) chat is mirrored into the CRM so conversations stay attached to
the lead they belong to. **It is a chat mirror and triage inbox — there is no AI in it.**

<details>
<summary><b>How it works</b></summary>

**Ingestion** — `quo-webhook` receives Quo events, verifies the request signature, honours
the `quo_webhook_ingestion_paused` admin switch, and upserts into `quo_conversations`,
`quo_messages`, `quo_webhook_events` and `quo_conversation_flags`. An existing
`linked_lead_id` is preserved, so a conversation never re-links to a different lead.

**Triage** — conversations carry their own status axis, independent of lead status:
`Raw` → `Spam` / `Contacted` → `Qualified Lead` / `Rejected` → `Successfully Completed`.

**Backfill** — `quo-reconcile-sync`, `quo-sync-contacts` and `quo-sync-history` reconcile
against the Quo API. Webhooks are the primary source; these are a safety net, not the main
ingest path.

**Outbound** — sending is delegated to the Quo Chrome extension, which queues into
`quo_outbound_messages`.

**Lead photos** — lead cards (including OPR cards) and lead details offer **Copy all
N photos**, producing one numbered combined image for a single paste. **Send photos
to tech** uses Donut 1.4.0 and later to hand the original images to the saved technician's exact
Quo conversation on the technician line. It follows Tech Quick Chat and technician
visibility permissions. Review the attachment batch in Quo and click **Send** there.
The downloadable extension is `public/Donut.zip`; reload the extension and refresh
CRM/Quo tabs after upgrading.

**Extension releases** — Donut's panel/settings show the installed version and release
date/time. The CRM header shows the latest version and detects the installed version;
new releases automatically show an in-app ZIP update notice. Donut is manually installed
via Chrome's **Load unpacked**, so notices link to instructions rather than claiming an
automatic installation. Prepare every extension release with
`npm run extension:release -- <new-version> "Release notes"`. This updates the manifest,
timestamps, release metadata and ZIP together. Builds run `extension:check` to reject
unpackaged source changes. Publish the CRM to make the release and notices available.

**Free map coordinates** — CRM and Donut use the authenticated Census-only
`geocode-lead-address` endpoint. Adding a Google API key cannot change the map
coordinate provider. Both clients reject non-Census coordinate results. Nearby
area previews can use approximate free fallbacks, but only Census matches of the
saved address are persisted to a lead's map coordinates.

**Realtime** — conversation changes invalidate the dashboard query directly; new chats
appear without a manual refresh.

</details>

> **Historical naming.** The table `quo_ai_settings` survives and is actively used, but
> only as a general key/value settings store — number labels and emojis, the ingestion
> pause switch, and the Sheets config. The name is left over from the removed AI layer.

---

## Architecture notes

**State management** — no Redux or Zustand. Server data lives in TanStack Query
(`staleTime` 60s, `gcTime` 5min, single retry, no refetch on focus or reconnect). Local
state is `useState`. Two React contexts: `AuthContext` and `NotepadContext`.

**Realtime** — one channel per concern, with `invalidateQueries` as the refresh
mechanism. A single shared `realtimeBus` (`src/lib/realtime.ts`) exists specifically to
avoid exhausting Supabase's per-project channel limit.

**Path alias** — `@/` → `src/`, declared in both `vite.config.ts` and `vitest.config.ts`.

**Two Vite configs** — `vite.config.ts` for the app (includes `lovable-tagger` in dev) and
`vitest.config.ts` for tests.

**Permissions are layered** — `src/lib/access.ts` holds the permission engine;
`AuthContext.canAccess` pre-empts a few keys before delegating to it.

---

## Getting started

Requires **Node.js 18+** and npm. [Install via nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone https://github.com/pastry-marketing/Marshmallow.git
cd Marshmallow
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in your Supabase project values.

To work on the database:

```sh
npm run sb:link
```

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm run preview` | Preview the build |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run sb:link` | Link the Supabase CLI to a project |
| `npm run sb:migrations` | List migration status |

---

## Testing

```sh
npm test
```

**27 test files, 291 tests passing.** Vitest with jsdom, tests co-located beside source
as `*.test.ts`. Supabase is mocked rather than hitting a test database.

Nine hand-run SQL harnesses in `supabase/tests/` cover what unit tests cannot — RLS and
role gates against real data:

| Harness | Covers |
|---|---|
| `20_manual_lead_gate.sql` | Manual lead gate and RLS hardening |
| `30_paid_status_rules.sql` | `paid` immutability and who may set it |
| `40_leads_rls_baseline.sql` | Per-role visible-lead matrices, diffed before/after policy changes |
| `50_tech_performance.sql` | Technician performance RPC and its admin gate |
| `60_optimized_areas.sql` | Optimized areas, area performance, location parsing |
| `70_google_sheets_sync_health.sql` | Sheets sync health, error pruning, lag watchdog |
| `75_google_sheets_transactional_outbox.sql` | Transactional capture, retries, generation-safe acknowledgements, full rebuild locking |
| `80_urgent_review_gate.sql` | Urgent gate behaviour: blocked and admitted transitions, self-approval, schedule preservation |
| `90_lead_coverage_us_places.sql` | Technician coverage distance rules and trigger recalculation |

These are **not** wired into any runner — run them in the Supabase SQL editor and read
the `PASS`/`FAIL` rows.

> When changing a `SELECT` policy, run `40_leads_rls_baseline.sql` before **and** after,
> and diff the two matrices.

### Harnesses assert behaviour, not existence

`80_urgent_review_gate.sql` is the clearest example of why. The first version of the
urgent gate had its condition inverted: it fired when status did **not** change, so every
real transition into urgent passed straight through while unrelated edits to
already-urgent leads were rejected instead.

It compiled. It applied cleanly. An existence check — "is the trigger there?" — would
have passed on it. Only executing a real transition and reading what the database
actually did catches that class of bug, so the behavioural checks there perform real
updates and assert on the outcome. Checks 8 and 9 read the function source and fail if
a schedule column is ever assigned.

---

## Migration workflow (important)

**Migrations are applied manually in the Supabase SQL editor.** The agent does not run
`supabase db push` or `db reset` against a shared project.

1. Write the migration in `supabase/migrations/`
2. Open the file from GitHub as raw text, copy it
3. Paste into the Supabase SQL Editor and run
4. Report the result

Always make migrations idempotent (`IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE`)
and give every file a header explaining the defect it fixes plus a rollback section.
Never write `UPDATE public.leads` in a migration.

> Verify database changes by **executing the query text from the file itself**, not a
> retyped copy. A retype can silently differ from what ships — that gap has hidden two
> real defects in this project.

### Bringing up the urgent AI check

Four steps, in this order. The first two are easy to miss and the feature is inert
without both.

1. **Apply the migration** — `20261104000000_urgent_review_gate.sql` in the Supabase SQL
   editor. Without it the trigger does not exist and a `customer_service` user can still
   set `urgent_job` directly. Nothing is enforced by the dialog alone.
2. **Set the secret** — `OPENAI_API_KEY` under Edge Functions → Secrets. Use a
   **Secret API key** nowhere; the Edge Function secret is the only place this belongs.
3. **Deploy the function** — `supabase/functions deploy check-urgent-lead --project-ref
   <ref>`. The web dashboard editor cannot resolve `../_shared/quo-ai.ts`, so either
   deploy via CLI or inline those three helpers.
4. **Run the harness** — `80_urgent_review_gate.sql`, and expect every row `PASS`.

Roles: `admin`, `processor` and `cs_admin` pass through the check without seeing the
dialog. `customer_service` is gated, and a `cs_admin` cannot approve a request they
raised themselves.

Urgent is dispatch priority and **never changes the agreed schedule**. Nothing in
`approve_urgent_verification`, `approve_urgent_acknowledgement` or
`review_urgent_request` writes `scheduled_date`, `scheduled_time_start` or
`customer_schedule_requirements`; harness checks 8 and 9 fail if that ever changes.

---

## Deployment

Hosted on **Lovable** — `lovable-tagger` runs in dev builds and `components.json` carries
the shadcn config.

`vercel.json` contains a single SPA rewrite so client-side routing survives refresh:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

---

## Project structure

```
src/
├── components/        UI (ui/ = shadcn, plus feature folders)
├── contexts/          AuthContext, NotepadContext
├── hooks/             useAllowedStatuses and data hooks
├── integrations/      Supabase client + generated Database types
├── lib/               Domain modules: access, statuses, payments, areas,
│                      technicians, proximity, geo, quo, motion, utils
├── pages/             One file per route
├── test/              Vitest setup
├── App.tsx            Router and route guards
└── index.css          Tailwind layers and theme tokens

supabase/
├── functions/         11 Deno Edge Functions (plus _shared/)
├── migrations/        176 SQL migrations
└── tests/             9 hand-run RLS harnesses
```

---

## Technical debt

Known gaps, recorded so they are not rediscovered:

- **No CI.** `.github/` does not exist; nothing runs on push or PR.
- **Playwright is configured but unused** — dependency and config are present, zero specs.
- **`/crm-updates` is unreachable.** `crm_updates` is missing from `ALL_NAV_ITEMS`, so the
  guard rejects it before reaching its own branch. The feature works inside
  Settings → CRM Updates.
- **In-app docs disagree with code** on OPR status-change access — `documentation-content.ts`
  says `partial_paid`, `STATUS_CHANGE_ACCESS` has `opr: []` and `opr_admin: []`.
- **`types.ts` is behind the schema.** Newer tables and RPCs are still called through
  `as never` casts. Regenerate with the Supabase CLI; never hand-edit.
- **Supabase URL and key are hardcoded** in `src/integrations/supabase/client.ts` instead
  of read from `import.meta.env`.
- **`.env.example` still lists AI variables** (`AI_MODEL_*`, `OPENAI_API_KEY`) that no
  source file reads.
- **No automated RLS tests** — the harnesses are manual.
- **One-off scripts at repo root** (`fix*.cjs`, `rewrite.cjs`, `test-*.cjs`) could be archived.

---

## House rules

**Mandatory CRM / Donut parity:** see [`AGENTS.md`](./AGENTS.md) and the
[feature parity / API setup matrix](./docs/CRM_EXTENSION_PARITY.md). Every shared
flow must be fixed and verified in both clients, with the same authenticated
backend and a freshly packaged higher extension version. Backend deployment,
CRM Publish and manual ZIP installation are separate release steps.

Contributing conventions are documented in [`GEMINI.md`](./GEMINI.md):

1. **Verify all five layers** for any role or feature change — UI, frontend permissions,
   database RLS, Edge Functions, database types. Never declare it done until the full chain
   from click to storage agrees.
2. **Always notify** when a migration is added or changed, so it can be run manually.

---

<div align="center">

<img src="https://img.shields.io/badge/maintained%20by-developer%20team-38BDF8?style=for-the-badge" alt="Maintained"/>
<img src="https://img.shields.io/badge/internal%20tool-private-64748B?style=for-the-badge" alt="Internal"/>

<br/>

<sub>Marshmallow CRM — internal tool. Access is role-gated and audited.</sub>

</div>
