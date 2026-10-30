# Recording the Marshmallow walkthrough videos

This guide is for the outgoing owner. It explains how to record a short video
series of the CRM and Donut, what to say in each video, and how to turn what
you said into written notes. You do not need to be a technical writer: talk
the way you would explain it to a new colleague sitting next to you.

The videos go with [`HANDOVER.md`](HANDOVER.md). When each one is uploaded,
paste its link into the table in section 14 of that page.

---

## 1. The plan in one paragraph

Record **12 short videos** (5–10 minutes each) instead of one long one. Short
videos are easier to re-record when you make a mistake, easier to find later,
and easier to update when one screen changes. For each video, read the
**script outline** below once, click through the steps once without
recording, then record. Afterwards, clean up the auto-generated transcript into
a page of notes using the template in section 7.

---

## 2. Before you press record: privacy (most important)

Marshmallow shows **real customers' names, phone numbers, addresses, photos
and conversations.** A video can be downloaded, forwarded and kept forever.
Treat every recording as if it might leave the company.

**Never show on screen:**

- Real customer details, chat text or call transcripts, if you can avoid it
- The Settings → Users page while access codes, 2FA QR codes, setup keys or
  password fields are visible
- The Supabase dashboard pages for **Edge Functions → Secrets**, **API keys**
  or **Project settings → API**
- The `.env` file, any API key, webhook secret or password
- Your email inbox, other browser tabs, chat apps or desktop notifications

**How to stay safe:**

1. **Best:** use a few clearly fake test leads (for example customer name
   "TEST – Jane Sample", phone `555-0100`, a public address such as a city
   hall). Creating them is a write to the live database, so agree it with the
   business first and delete or cancel them afterwards through the normal
   screens.
2. **If you must use real data:** zoom into the part of the screen you are
   explaining, and blur names and numbers when editing (Loom, Camtasia,
   Descript and the free tool Shotcut can all blur a region).
3. Store the videos in a **private** company folder (Google Drive, OneDrive,
   or a private Loom workspace) shared only with named people. Not public or
   "unlisted" YouTube.
4. Hand over passwords and keys through a password manager, never in a video.

---

## 3. Set up your recording

**Tools (pick one)**

| Tool | Cost | Good for |
|---|---|---|
| **Loom** | Free tier | Easiest. Records screen + voice + optional face bubble, gives a link and an automatic transcript |
| **OBS Studio** | Free | Full control, records to a file on your computer |
| **Windows**: `Win + Alt + R` (Xbox Game Bar) or Clipchamp | Free | Built in on Windows |
| **Mac**: `Shift + Cmd + 5` | Free | Built in on macOS |

**Prepare the screen**

- Use a clean Chrome profile with only the CRM and Quo tabs open.
- Turn on *Do Not Disturb* so no notifications pop up.
- Set browser zoom to **110–125%** so text is readable in the video.
- Record at 1080p if you can. Use a headset or a quiet room for sound.
- Log in **before** you start recording, so the password screen is never shown.
- Close the notepad and any lead that has private notes you do not want shown.

**Which account to use**

The CRM looks different for each role. Recording as Admin shows everything,
which is fine, but at each screen **say which roles can see it** (the tables in
`HANDOVER.md` section 5 tell you). If test accounts for other roles already
exist, you can briefly log in as one to show the difference. Do not create new
users just for the video without agreement.

---

## 4. How to talk (plain language)

For every screen, answer the same six questions, in this order. This is the
whole technique:

1. **What is this screen?** "This is the Schedule. It shows every booked job."
2. **Who uses it?** "Processors live on this page; CS checks it too."
3. **When do they use it?** "First thing in the morning, to see today's jobs."
4. **Show one real task**, start to finish, slowly. Narrate each click:
   "I click the lead… now I change the status to Scheduled…"
5. **What can go wrong?** "If the technician isn't assigned, this button is
   greyed out."
6. **What must never happen?** "Never mark something Paid from here; only the
   Admin approves payments."

**Tips**

- Move the mouse slowly and pause one second after each click.
- Say the **name on the button** exactly as it appears, so people can find it.
- If you make a mistake, pause, say "let me redo that", and carry on. You can
  cut it out later, or just leave it; honesty is fine.
- Don't explain code in the screen videos. Video 10 is the only "behind the
  scenes" one.
- If you don't know why something works the way it does, say so out loud:
  "I'm not sure why this is here; check with ___." That is valuable
  information for the next owner.
- At the end of each video, say what the next video is.

---

## 5. The video series: script outlines

Each outline has **Show** (what to click) and **Say** (the kind of thing to
say, in your own words). The "Say" lines are suggestions, not a script to read.

### Video 0 — Welcome and the big picture (~5 min)

**Show:** the CRM home screen, then the sidebar, then this repository's
`docs/HANDOVER.md` on GitHub.

**Say:**
- "Marshmallow is our private CRM. Customers contact us through Quo, we turn
  the conversation into a lead, quote it, find a technician, schedule the job,
  and make sure we're paid our share."
- "There are six roles: Admin, CS Admin, Customer Service, Processor, OPR and
  OPR Admin. Each one sees different screens."
- "There's a Chrome extension called Donut that works inside Quo."
- "These videos go screen by screen. The written handover guide is in the
  repository at `docs/HANDOVER.md`."

### Video 1 — Logging in and finding your way around (~5 min)

**Show:** the login page (already logged out, nothing typed), the 2FA step if
it appears (do not show a QR code), then the sidebar groups (Work, Review,
Manage, Insights, Admin, By Status), the header (Donut button, notifications
bell, theme switch, notepad), and the command menu (`Ctrl+K`).

**Say:**
- "Everyone logs in with email and password. Some people also need an access
  code or a two-factor code from an authenticator app."
- "The sidebar only shows what your role is allowed to see. If someone says a
  screen is missing, check their role and Feature Access in Settings."
- "The bell is your notifications. The Donut button tells you if your
  extension is out of date."

### Video 2 — All Leads and the lead detail page (~10 min)

**Show:** All Leads; searching; filtering by status from **By Status**; the
Need Attention view; opening a lead; each section of the lead detail page
(customer, address, quote, schedule, technician, photos, chat, history);
Copy Details and Copy/View photos.

**Say:**
- "This is where most people spend their day."
- "Urgent and pinned leads float to the top on purpose."
- "Each status is a step in the job's journey. Not everyone can see every
  status, and seeing a status doesn't mean you can change it."
- "Copy Details copies everything about the job so you can paste it to a
  technician."
- "The history shows who changed what. That's our audit trail."

### Video 3 — Creating a lead and following its journey (~10 min)

**Show:** with a **test** lead: New Lead (or show the button and explain who
has it), filling the form, Find Address, saving; then walk it through the
statuses: needs quote → quote sent → need tech → scheduled → job in progress
→ job done → payment pending. Stop before payment approval (that's video 6).
Show the urgent request dialog without submitting it if you'd rather not.

**Say:**
- "Normally leads come from Quo through Donut, but you can also add one here
  if you have the Manual Lead permission."
- "The address lookup uses the free US Census service. That's what puts the
  job on the map."
- "When CS marks something urgent, the AI compares the lead with the
  customer's chat. It's only advice; a CS Admin decides. And urgent never
  changes the time the customer agreed to."
- "Paid is the end of the road. Once a lead is Paid it can never change again,
  and only an Admin can make it Paid."

### Video 4 — QUO Inbox and AI Assistance (~6 min)

**Show:** QUO Inbox list and analytics tabs; opening a conversation; the
triage statuses; the link between a conversation and a lead; AI Assistance
(Missed-Lead Tracker). Blur or avoid real message text.

**Say:**
- "Every Quo call and text is copied here automatically by a webhook. We don't
  send messages from here; people reply in Quo itself."
- "Conversations have their own status, separate from the lead status: Raw,
  Spam, Contacted, Qualified Lead, Rejected, Successfully Completed."
- "AI Assistance is the missed-lead tracker: missed calls and texts nobody has
  answered. CS should check it at the start of every shift. Items disappear
  once someone replies."
- Point at the **Webhook Active / Webhook Paused** button at the top (do
  **not** click it while recording; it stops new chats coming in): "If new
  chats stop appearing, check this button first. Paused means Quo messages are
  not being copied in."

### Video 5 — Schedule, Map View and Processor Board (~10 min)

**Show:** the Schedule board (today, due, overdue); Map View with filters,
coverage areas and nearby technicians; the Processor Board list, its status
filters (Take Job Update, Job In Progress, Payment Pending, Send Dose, Wrong
Tech Number, Not enough details, Upcoming), opening **Review** on one job,
Tech Quick Chat, Open lead.

**Say:**
- "Processors use these three screens to dispatch and follow jobs."
- "The map helps find the closest technician to a job."
- "The Processor Board reads the technician's chat on the server and suggests
  the next step. Opening the board doesn't run the AI; it already ran when a
  new message came in. It's a suggestion. The processor still decides."
- "Send Dose means the technician finished, but hasn't sent our share three
  days after the job, so they need a reminder."

### Video 6 — The review queues (~10 min)

**Show:** each Review screen in turn: Cancellation requests, Payment
approvals, Quote Approval, Quotes to send, Tech Approvals, Urgent review, Get
CX Update, Get Tech Update. For each one, show where the request comes from
(the button on a lead) and the approve/decline buttons. You do not need to
approve anything real.

**Say:**
- "Important changes are never made directly. Someone asks, and someone else
  approves. That protects us from mistakes and fraud."
- "Payment approvals are Admin-only. Approving is what makes a lead Paid."
- "A CS Admin can't approve their own urgent request."
- "Processors can't change a technician's Good Tech flag directly; it comes
  here for the Admin."
- "CX Update is asking the customer side for news; Tech Update is asking the
  technician side."

### Video 7 — Technicians, areas, analytics and logs (~8 min)

**Show:** Technicians (Directory, OPR Report, Tech Report, Processing
Workflow); Area Insights; Optimization; Analytics (Operations Performance,
Lead Coverage & Sources, CS Team Performance); Activity Logs.

**Say:**
- "This is our technician list. The Good Tech flag and active status matter
  for dispatch."
- "Processing Workflow is an AI summary of selected technicians' recent
  chats. Missing chat history means *unavailable*, not that the technician did
  something wrong."
- "Optimization ranks areas by jobs that actually closed. Admin only."
- "Activity Logs answer 'who did this?'. Check here first when something
  changed unexpectedly."

### Video 8 — Settings and user management (~8 min)

**Show:** Settings tabs: Users (hide or zoom past codes, QR codes and
password fields), Feature Access, Status Visibility, Templates, Security, CRM
Updates, Google Sheets, Documentation.

**Say:**
- "This is how you add someone, set their role, and reset their password or
  2FA."
- "Feature Access switches individual screens on or off per person, on top of
  their role."
- "Status Visibility decides which statuses a person can see. It's separate
  from which statuses they can change."
- "Templates are the messages we copy to technicians."
- "Google Sheets shows whether the spreadsheet copy is healthy."
- "When someone leaves, remove them here."

### Video 9 — Donut, the Chrome extension (~8 min)

**Show:** `chrome://extensions` with Donut loaded (Developer mode); the Donut
button in the CRM header; downloading `Donut.zip`; on Quo, highlighting text,
tagging it, the side panel, Find Address, Check Lead, the urgent check, and
Technician Intelligence (as Admin/Processor). Use a test conversation or blur.

**Say:**
- "Donut isn't in the Chrome Web Store. You download the ZIP from the CRM,
  unzip it, and use Load unpacked."
- "To update: replace the folder, click Reload, then refresh the CRM and Quo
  tabs."
- "Only the text you highlight goes into the lead. Donut never sends the whole
  chat."
- "Send photos to tech puts the photos into the right Quo chat, but you still
  have to press Send in Quo."
- "Any feature that's in both Donut and the CRM has to be fixed in both."

### Video 10 — How a change goes live (behind the scenes) (~10 min)

This is the only technical video. Speak to the next developer.

**Show:** GitHub (the repo, a pull request, the **Validate** check); Lovable
(preview vs **Publish**); Supabase (Database → Migrations list, the SQL
editor, Edge Functions list with deploy dates). **Do not open** Secrets, API
keys or `.env`.
Briefly show the folders: `src/`, `supabase/migrations/`, `supabase/tests/`,
`supabase/functions/`, `tmp_extension/quo-crm-extension/`, `docs/`.

**Say:**
- "Merging to main doesn't change what users see. The Admin has to click
  Publish in Lovable."
- "Database changes are SQL files we paste into the Supabase SQL editor by
  hand. Never run `supabase db push` against our project; it's live
  production."
- "After a migration, run its test script from `supabase/tests/` and check
  every row says PASS."
- "Edge Functions are deployed separately with the Supabase CLI."
- "A Donut change needs `npm run extension:release`, then the CRM is
  published, then every user reloads the extension."
- "Before any change, run `npm run validate`. GitHub runs it too."
- "The rules for working on this code are in `AGENTS.md`. Read them first."

### Video 11 — Wrap-up: what's unfinished and who to ask (~5 min)

**Show:** `docs/HANDOVER.md` sections 8, 9 and 12.

**Say:**
- Walk through each "work in progress" row and say what you know: live,
  pending, or abandoned.
- Anything you planned, promised to users, or know is fragile.
- Who in the business to ask about what.
- "If I had one more week, I'd…" (this is often the most useful minute).

---

## 6. After recording

1. **Name files consistently:** `marshmallow-01-login-and-navigation.mp4`.
2. **Check for privacy** by watching at 2× speed: any customer data, codes or
   keys? Blur or re-record.
3. **Upload** to the private folder and paste the link into
   [`HANDOVER.md` section 14](HANDOVER.md#14-walkthrough-videos).
4. **Re-record only the video that changed** when a screen changes later.

---

## 7. Turning what you said into written notes

Loom, Descript, Clipchamp and Microsoft Stream create a transcript
automatically. A transcript is messy, so turn each one into a short page with
this template:

```markdown
## Video N — <title>

**Screen(s):** <names exactly as in the sidebar>
**Who uses it:** <roles>
**When:** <time of day / situation>

**How to do the main task**
1. ...
2. ...

**Watch out for**
- ...

**Never**
- ...

**Open questions / things I'm not sure about**
- ...
```

You can paste a transcript into an AI assistant and ask it to fill in this
template, **but only after removing any customer names, phone numbers,
addresses or chat text** from the transcript. Then read the result and fix
anything it got wrong; you are the expert here, not the AI.

Where to put the notes: either add them to the bottom of `HANDOVER.md` under
the video table, or create `docs/handover-notes/video-NN.md` files and link
them from the table.

---

## 8. Final checklist

- [ ] All 12 videos recorded, privacy-checked and uploaded to a private folder
- [ ] Links added to `HANDOVER.md` section 14
- [ ] Written notes made for each video
- [ ] Every **FILL IN** in `HANDOVER.md` completed
- [ ] One live session where the new owner drives the CRM and you answer
      questions
