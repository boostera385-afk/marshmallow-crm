# Marshmallow handover guide

**Who this is for:** the person taking over Marshmallow — a developer, an
operations owner, or both. It is written in plain language first. Technical
detail lives in the documents it links to.

**How to use it:** read this page, watch the walkthrough videos (table below),
then read the technical documents in the order given in
[Start here](#1-start-here). Anything marked **FILL IN** is knowledge only the
outgoing owner has; it must be completed before the handover is finished.

> Facts here were checked against the code on 2026-10-30 (111 unit-test files,
> 1,088 tests passing; 21 Edge Functions; 223 migrations). The state of the live
> Supabase project, Lovable and the installed Donut extension was **not**
> checked from the code. Confirm those directly (see
> [Work in progress](#9-work-in-progress-at-handover)).

---

## Contents

1. [Start here](#1-start-here)
2. [Marshmallow in one minute](#2-marshmallow-in-one-minute)
3. [Who uses it: the six roles](#3-who-uses-it-the-six-roles)
4. [The journey of a lead](#4-the-journey-of-a-lead)
5. [A tour of every screen](#5-a-tour-of-every-screen)
6. [Donut, the browser extension](#6-donut-the-browser-extension)
7. [Rules that must never break](#7-rules-that-must-never-break)
8. [The services behind it](#8-the-services-behind-it)
9. [Work in progress at handover](#9-work-in-progress-at-handover)
10. [How a change goes live](#10-how-a-change-goes-live)
11. [First day for the new owner](#11-first-day-for-the-new-owner)
12. [Handover checklist](#12-handover-checklist)
13. [Glossary](#13-glossary)
14. [Walkthrough videos](#14-walkthrough-videos)

---

## 1. Start here

| Order | Read | Why |
|---|---|---|
| 1 | This page | The big picture in plain words |
| 2 | The walkthrough videos ([section 14](#14-walkthrough-videos)) | See every screen being used |
| 3 | [`README.md`](../README.md) | Technical overview: stack, database, Edge Functions, scripts |
| 4 | [`AGENTS.md`](../AGENTS.md) and [`GEMINI.md`](../GEMINI.md) | The house rules for anyone (human or AI) changing the code |
| 5 | [`docs/RELEASE_PROCESS.md`](RELEASE_PROCESS.md) | Who may merge and who may publish |
| 6 | [`docs/CRM_EXTENSION_PARITY.md`](CRM_EXTENSION_PARITY.md) | Which features exist in both the CRM and Donut |
| 7 | Feature rollout notes in `docs/*_ROLLOUT.md` | History and pending steps for the bigger features |

Admins can also read the in-app documentation in **Settings → Documentation**.
It is older than this page in places (see the README's *Technical debt*
section); where they disagree, the code wins.

---

## 2. Marshmallow in one minute

Marshmallow is the company's private CRM for a home-services business.
Customers contact the business by phone and text through **Quo** (formerly
OpenPhone). The team turns those conversations into **leads** (jobs), gets a
quote to the customer, finds a **technician**, schedules the visit, follows the
job, and finally confirms the business has been **paid** its share.

Three things make it different from a generic CRM:

- **Everything is permission-based.** Six roles see different screens and
  different lead statuses, and can change different things.
- **Important steps need an approval.** Quotes, payments, cancellations,
  urgent jobs and technician changes go through a review queue instead of being
  changed directly.
- **It lives next to Quo.** Conversations are copied into the CRM
  automatically, and the **Donut** Chrome extension lets staff create leads
  straight from a Quo chat.

---

## 3. Who uses it: the six roles

A person's role is stored in the `user_roles` table. An Admin can also switch
individual screens and features on or off per person in **Settings → Feature
Access**.

| Role | In plain words | Sees by default |
|---|---|---|
| **Admin** | The owner/manager. Can see and do everything, and is the only one who can mark a lead **Paid**. | Every screen |
| **CS Admin** | Leads the customer-service team. Reviews urgent requests and can manage CS users if allowed. | Leads, Schedule, Quote Approval, Urgent review, AI Assistance, CX/Tech Updates, Notifications |
| **Customer Service (CS)** | Talks to customers, creates leads, sends quotes, asks for urgent review. | Leads, Schedule, Quote Approval, AI Assistance, CX/Tech Updates, Notifications |
| **Processor** | Dispatch. Finds and assigns technicians, follows jobs, handles cancellations. | Leads, Schedule, Processor Board, Cancellation requests, Map View, Technicians, CX/Tech Updates, Notifications |
| **OPR (Operator)** | Works with a set of technicians. Narrow, mostly read-only view of their own leads. Cannot change a lead's status. | Leads only |
| **OPR Admin** | Like OPR, plus technician management when an Admin grants it. | Leads only (Technicians when granted) |

Per-person switches that are separate from the role: **Quotation Master**
(the "Quotes to send" queue), **Manual Lead** (the New Lead button), **Tech
Report**, **Copy Details**, **Can manage users** (for CS Admins) and an
**OPR code** (which technicians an operator sees).

**Important:** hiding a button is not security. Every permission is also
enforced in the database. See the "five layers" rule in `GEMINI.md`.

---

## 4. The journey of a lead

This is the normal path, in plain words. The technical status names are in
brackets.

1. **A customer gets in touch** by call or text in Quo. The conversation
   appears in the CRM's **QUO Inbox** automatically.
2. **CS creates a lead**, either from the Quo chat with Donut or with the
   **New Lead** button. If details are missing it waits
   (`waiting_complete_details`).
3. **It needs a price** (`needs_quote`, or `tech_making_quote` when a
   technician prices it). CS asks for quote approval when required, then sends
   it (`quote_sent_waiting`).
4. **If it is urgent**, CS asks for urgent review. The AI compares the lead
   with the customer's conversation and reports anything that disagrees; a CS
   Admin decides. Urgent never changes the time the customer agreed to.
5. **The customer accepts**, so a technician is needed (`need_tech`). The
   Processor finds one (Map View, Technicians) and assigns them.
6. **The visit is booked** (`scheduled`), then the job runs
   (`job_in_progress`) and finishes (`job_done`).
7. **Payment.** The technician owes the business its share
   (`payment_pending`). A payment request with evidence goes to the Admin
   (`payment_requested`). Only the Admin approves it, and the lead becomes
   **Paid** (`paid`).
8. **Paid is final.** A paid lead can never change status again.

Side roads: the customer cancels (`cancellation_requested` → `cancelled`), the
visit moves (`needs_reschedule`), the quote changes (`quote_change`,
`quote_updated`), part-payment (`partial_paid`), or fraud (`scammed`). There
are 25 statuses in total; the README lists them all.

---

## 5. A tour of every screen

The left sidebar is grouped into **Work**, **Review**, **Manage**, **Insights**
and **Admin**, plus a **By Status** list. People only see the items their role
or grants allow.

### Work

| Screen | What it is for | Who |
|---|---|---|
| **All Leads** (`/leads`) | The main list. Search, filter by status, open a lead, change status, copy details or photos. Urgent and pinned leads sort to the top. | Everyone |
| **Lead detail** (`/leads/:id`) | Everything about one job: customer, address, quote, schedule, technician, photos, chat, history. Most actions start here. | Everyone (scoped) |
| **QUO Inbox** (`/quo-monitor`) | Mirror of all Quo conversations, with its own triage status (Raw, Spam, Contacted, Qualified Lead, Rejected, Successfully Completed). The **Webhook Active / Paused** button at the top stops or resumes copying new Quo messages in. | Granted users |
| **AI Assistance** (`/ai-assistance`) | The *Missed-Lead Tracker*: missed calls and unanswered texts across CS numbers. Items clear once someone replies. A start-of-shift worklist. | Admin, CS Admin, CS |
| **Schedule** (`/schedule`) | The job schedule board: what is booked, what is due or overdue. | Admin, Processor, CS Admin, CS |
| **Notifications** (`/notifications`) | Your own notification history and sound settings. | Admin, Processor, CS Admin, CS |
| **Processor Board** (`/processor-board`) | Every assigned, unfinished job in one list, with a suggested next step from the technician chat (for example *Take Job Update*, *Payment Pending*, *Send Dose*, *Wrong Tech Number*). Suggestions are advice; the server computes them. | Admin, Processor |
| **Map View** (`/map-view`) | Leads and technicians on a map, coverage areas and nearby urgent jobs. | Processor, Admin, granted |

### Review (approval queues)

| Screen | What it is for | Who decides |
|---|---|---|
| **Need Attention** | Urgent leads whose schedule requirements are due or overdue. | — |
| **Cancellation requests** | Approve or decline a cancellation, with proof image. | Admin, Processor |
| **Payment approvals** | Approve a payment and move the lead to Paid. | **Admin only** |
| **Quote Approval** | Quotes that need approval before they are sent. | Granted reviewers |
| **Quotes to send** | Approved quotes waiting to go to the customer. | Admin, Quotation Masters |
| **Tech Approvals** | Processor requests to change a technician's Good Tech or active flag. | Admin |
| **Urgent review** | Urgent requests the AI flagged, or that could not be checked. A CS Admin cannot approve their own request. | CS Admin, Admin |
| **Get CX Update / Get Tech Update** | Ask the customer side or technician side for an update on a lead, and see the answer. | Admin, Processor, CS Admin, CS |

### Manage and Insights

| Screen | What it is for | Who |
|---|---|---|
| **Technicians** | The technician directory, plus *OPR Report*, *Tech Report* and *Processing Workflow* (AI summary of chosen technicians' recent chats). | Processor, Admin, granted |
| **Area Insights** | How each area performs. | Granted |
| **Optimization** | Areas ranked on jobs that actually closed; mark an area to track it. | **Admin only** |
| **Analytics** | Operations performance, lead coverage and sources, and CS Team Performance. | Granted |
| **Activity Logs** | Who did what and when (the audit trail). | Admin by default |

### Admin: Settings

| Tab | What it is for |
|---|---|
| **Users** | Create users, set passwords, OPR codes, access codes, two-factor (2FA) setup and reset, delete users. CS Admins with *Can manage users* see a limited version. |
| **Feature Access** | Per-person on/off switches for screens and features. |
| **Status Visibility** | Which lead statuses each person can see. |
| **Templates** | The *Copy Technician Message* and *Reminder Message* texts filled in from a lead. |
| **Security** | Your own password and 2FA. |
| **CRM Updates** | Send a one-time announcement to chosen roles. |
| **Google Sheets** | The Google Sheets sync and its health. |
| **Documentation** | The in-app technical documentation. |

The header also has a **Donut** button (latest extension version and how to
update), a theme switch, a notepad, and a command menu (`Ctrl+K` / `⌘K`).

---

## 6. Donut, the browser extension

**Donut** is a Chrome extension used on the Quo website. Its code is in
`tmp_extension/quo-crm-extension/` (the folder name is historical; it is the
real source). Current version: **1.7.0**.

What staff use it for:

- **Create a lead from a chat.** Highlight text in a Quo chat, tag it
  (customer name, service, address…), review it in the side panel, and click
  **Create Lead**. Nothing from the chat is sent unless the user selects it.
- **Update a schedule** on an existing lead (**Check Lead**).
- **Find Address** and see technician coverage, using the same free US Census
  lookup as the CRM.
- **Urgent check** on intake, using the same AI check as the CRM.
- **Technician Intelligence** (Admin and Processor): look up the technician
  for a phone number and review their chat history.
- **Send photos to tech:** the CRM hands a lead's photos to the right
  technician chat in Quo. The user still clicks **Send** in Quo; Marshmallow
  never sends it on their behalf.

How it is installed: it is **not** in the Chrome Web Store. Users download
`Donut.zip` from the CRM, unzip it, and use **Load unpacked** in
`chrome://extensions` with Developer mode on. To update, they replace the
folder, click **Reload**, and refresh their CRM and Quo tabs. The CRM shows a
notice when a newer version is published.

The big rule: if a feature exists in **both** the CRM and Donut, a fix must be
made in both, using the same backend. See
[`CRM_EXTENSION_PARITY.md`](CRM_EXTENSION_PARITY.md).

---

## 7. Rules that must never break

These are business rules, not just code style. `AGENTS.md` has the full list.

1. **Paid is final**, and only an Admin (or a trusted server job) can set it.
2. **Approvals stay approvals.** Quote, payment, cancellation, urgent and
   technician changes go through their queues. No shortcuts that write
   directly.
3. **Urgent never moves the customer's schedule.**
4. **AI is advice, never permission.** It can suggest; it cannot approve or
   change a status by itself. If the AI could not check something, it says
   *unavailable*, never *passed*.
5. **Operators (OPR / OPR Admin) cannot change lead status.**
6. **Map points come only from the US Census lookup** of the saved address.
7. **Secrets never go in the browser, Donut, or git.** The committed `.env`
   only holds the public Supabase URL and publishable key; real secrets live
   in Supabase → Edge Functions → Secrets.
8. **The Supabase project `kxiqholnmhkwhdkhtopp` is live production.** Never
   run `supabase db push` or `db reset` against it. Migrations are pasted into
   the SQL editor by hand.

---

## 8. The services behind it

| Service | What it does for Marshmallow | If it stops working | Account owner / login (**FILL IN**) |
|---|---|---|---|
| **GitHub** (this repo) | The code. Pull requests and the `Validate` check (lint, typecheck, tests, build) live here. | Nobody can change the code safely | |
| **Lovable** | Hosts the CRM website. Builds from `main`; users only get changes when an Admin clicks **Publish**. | The CRM site is down or out of date | |
| **Supabase** (project `kxiqholnmhkwhdkhtopp`) | Database, logins, file storage, realtime updates and the 21 Edge Functions. | Everything stops | |
| **Quo / OpenPhone** | Phone and text. Sends webhooks to Marshmallow, which copies conversations in. | New chats stop appearing | |
| **OpenAI** | Powers the advisory AI checks (urgent check, processor board, cancellation reasons, technician summaries). Key is an Edge Function secret. | AI checks show *unavailable*; normal work continues | |
| **Google Sheets** | The CRM keeps a copy of leads in a spreadsheet. | The sheet goes stale; Settings → Google Sheets shows health | |
| **US Census geocoder** | Free address lookup for map points. No account needed. | New map points are not saved | — |

**FILL IN** for each paid service: who pays, the renewal date, and where the
login is stored (a password manager, never this file).

---

## 9. Work in progress at handover

The rollout documents record several changes as built in the code but **not
yet live**. This list was taken from those documents; the new owner must
confirm each item against Supabase and Lovable, because the code cannot tell
whether a manual step was done later.

| Item | What is pending (per the docs) | Where it is described |
|---|---|---|
| Processor Board v2–v4, customer's side, payment screenshots | Migrations `20261122*` to `20261127000000` applied by hand; `processor-board` and `processor-board-daily` Edge Functions redeployed | [`PROCESSOR_BOARD_ROLLOUT.md`](PROCESSOR_BOARD_ROLLOUT.md) |
| CX / Tech update requests | Apply `20261121001000_fix_update_request_notification_uuid.sql` after the Tech Update migration | [`CRM_EXTENSION_PARITY.md`](CRM_EXTENSION_PARITY.md) |
| CS Team Performance access | Migration `20261128000000_cs_team_performance_access.sql`; harness `170_cs_team_performance.sql` | Latest commits |
| Sheets watchdog | Migration `20261129000000_sheets_watchdog_cron_caller.sql`; harness `71_sheets_watchdog_cron_caller.sql` | Latest commits |
| Copilot | Paused in the database. The function's release gate is still awaiting deployment. Do not re-enable without testing. | [`COPILOT_ROLLOUT.md`](COPILOT_ROLLOUT.md) |
| Request resolution, notification center, schedule monitor | Held on purpose: the migrations must ship together with a CRM Publish | [`WORKFLOW_INBOX_ROLLOUT.md`](WORKFLOW_INBOX_ROLLOUT.md) |
| `CHANGELOG.md` *Unreleased* section | Lists work that was staged but not published | [`CHANGELOG.md`](../CHANGELOG.md) |

How to check: run `npm run sb:migrations` (read-only list), or look in the
Supabase dashboard under **Database → Migrations** and **Edge Functions**
(the deployed date).

**FILL IN:** anything else half-finished, promised to users, or known to be
fragile that is not written down anywhere.

Known gaps in the code are listed in the README under
[*Technical debt*](../README.md#technical-debt).

---

## 10. How a change goes live

A merged change is **not** automatically live. There are four separate
release steps, and each one needs a deliberate person to do it:

| Step | What | Who does it |
|---|---|---|
| 1. **CRM website** | Merge to `main`, test on the Lovable preview, then click **Publish** in Lovable | Admin (see `RELEASE_PROCESS.md`) |
| 2. **Database** | Open the migration from `supabase/migrations/`, paste it into the Supabase SQL editor, run it, then run its harness from `supabase/tests/` and check every row says `PASS` | Admin / developer, by hand |
| 3. **Edge Functions** | Deploy the changed function with the Supabase CLI (`supabase functions deploy <name> --project-ref kxiqholnmhkwhdkhtopp`) | Developer, with approval |
| 4. **Donut** | `npm run extension:release -- <new version> "notes"`, commit the generated files, publish the CRM, then each user reloads the extension | Developer, then every user |

Before any change, the developer runs `npm run validate` (lint, typecheck,
tests and build). GitHub runs the same check on every pull request.

---

## 11. First day for the new owner

1. Get added to GitHub, Lovable, Supabase, Quo and OpenAI (section 8).
2. Install Node.js 18 or newer, clone the repo, run `npm install`.
3. Run `npm run validate`. It should end with all tests passing.
4. Run `npm run dev` and open `http://localhost:8080`. **Careful:** local
   development talks to the live database. Use test records only.
5. Install Donut from `public/Donut.zip` with **Load unpacked**.
6. Log in with your own Admin account (with 2FA) and click through every
   screen while watching the videos.
7. Work through [section 9](#9-work-in-progress-at-handover) and confirm what
   is really live.

---

## 12. Handover checklist

Tick each item before the outgoing owner leaves.

- [ ] New owner has Admin access to GitHub, Lovable, Supabase, Quo, OpenAI
      and Google (Sheets).
- [ ] Billing and renewal for every paid service moved or documented.
- [ ] Passwords and API keys handed over through a password manager, **not**
      in chat, email, video or this repo.
- [ ] The outgoing owner's personal accounts removed or downgraded in each
      service, and their CRM user deactivated (after the new owner has Admin).
- [ ] 2FA for every Admin account reset to devices the new owner controls.
- [ ] All walkthrough videos recorded and linked in
      [section 14](#14-walkthrough-videos).
- [ ] Every **FILL IN** in this page completed.
- [ ] Each item in [section 9](#9-work-in-progress-at-handover) confirmed as
      live, pending, or abandoned.
- [ ] A live Q&A session held where the new owner drives and the outgoing
      owner watches.

**People and contacts (FILL IN)**

| Who | Role in the business | How to reach | Ask them about |
|---|---|---|---|
| | | | |

---

## 13. Glossary

| Word | Meaning |
|---|---|
| **Lead** | One customer job, from first contact to payment |
| **Status** | Where a lead is in its journey; 25 exist |
| **CS** | Customer Service |
| **OPR** | Operator: works with a set of technicians |
| **Processor** | Dispatch: assigns and follows technicians |
| **Quo** | The phone/text system (formerly OpenPhone) |
| **Donut** | The Chrome extension used inside Quo |
| **Share** | The business's part of a job's payment, which the technician sends |
| **Send Dose** | Processor Board label: the job is done, but the technician has not sent the share 3+ days after the scheduled time, so they need a reminder |
| **Edge Function** | A small program that runs on Supabase's servers; holds the secrets |
| **Migration** | A SQL file that changes the database; applied by hand here |
| **Harness** | A SQL test script in `supabase/tests/`, run by hand, read for `PASS`/`FAIL` |
| **RLS** | Row Level Security: database rules that decide who can read or change each row |
| **Publish** | The Lovable button that sends a new CRM version to users |
| **Parity** | Keeping a shared feature the same in the CRM and Donut |

---

## 14. Walkthrough videos

How to record them, and what to say in each one, is in
[`VIDEO_WALKTHROUGH_GUIDE.md`](VIDEO_WALKTHROUGH_GUIDE.md). Add each link here
once it is uploaded to the private shared folder.

| # | Video | Length | Link (**FILL IN**) |
|---|---|---|---|
| 0 | Welcome and the big picture | ~5 min | |
| 1 | Logging in and finding your way around | ~5 min | |
| 2 | All Leads and the lead detail page | ~10 min | |
| 3 | Creating a lead and following its journey | ~10 min | |
| 4 | QUO Inbox and AI Assistance | ~6 min | |
| 5 | Schedule, Map View and Processor Board | ~10 min | |
| 6 | The review queues (approvals) | ~10 min | |
| 7 | Technicians, areas, analytics and logs | ~8 min | |
| 8 | Settings and user management | ~8 min | |
| 9 | Donut, the Chrome extension | ~8 min | |
| 10 | How a change goes live (behind the scenes) | ~10 min | |
| 11 | Wrap-up: what is unfinished and who to ask | ~5 min | |
