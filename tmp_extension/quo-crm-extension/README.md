# Donut

Donut is Marshmallow CRM's Chrome extension (Manifest V3) for the Quo website.
Staff create and update CRM leads from a Quo chat without leaving the page.

Donut signs in as the user and talks to the same Supabase backend, RPCs and
Edge Functions as the CRM, so the CRM's permissions (RLS), approval gates and
AI checks apply unchanged. It contains no service-role, AI, Quo or webhook
secrets. A feature that exists in both clients must be fixed in both; see
`docs/CRM_EXTENSION_PARITY.md` in the CRM repository.

## Install (Load unpacked)

Donut is not in the Chrome Web Store.

1. In the CRM, click the **Donut** button in the header and download `Donut.zip`.
2. Extract it to a folder you will keep (it contains `quo-crm-extension`).
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted `quo-crm-extension` folder.
5. Pin Donut from the extensions menu.

## Set up and sign in

1. Open Donut's **Options** page and set **CRM Website URL** (the CRM's address,
   used for links back to leads, the technician workflow and release checks).
   Click **Save Settings**. No API token is used.
2. Open Donut on a Quo tab; the side panel opens.
3. Sign in with your normal CRM email and password. Two-factor (TOTP) and access
   codes are asked for exactly as in the CRM.

## Create a lead from a Quo chat

1. Highlight text in the chat. A floating menu offers **Customer Name**,
   **Customer Number**, **Address**, **Number Name**, **Service Name / Keyword**
   and **Schedule Req.**; the selected text fills that field in the side panel.
2. Helpers in the panel:
   - **Direction → Auto** detects who started the conversation (Incoming / Outgoing).
   - **Customer Phone → Auto** reads the number from the chat header; the area
     button shows the number's assigned rate center from the bundled NANPA
     NPA-NXX data (exact 6-digit prefix only; not the caller's location).
   - **Address → Find** standardizes the address through the CRM's
     `geocode-lead-address` function (US Census only); Apt/Suite/Unit/# is kept.
   - **Number Label → Auto** and **Service Keyword → Auto** fill from the page or
     the selected text.
   - **Chat Pictures → Pick** collects the chat's images, with a preview viewer.
3. Add Service Details, Reference and Schedule Note, then choose:
   - **Lead Status:** Default, Urgent, Quote Pending to Send or Quote Sent.
   - **Estimate / Quote:** Free Estimate, or Quoted with a Quote Amount.
4. Click **Create Lead**.

Rules that match the CRM:

- A customer name or number is required.
- Only highlighted and assigned text is captured; the whole chat is never sent.
- The draft is saved locally and survives closing the panel; **Clear Draft**
  empties it.
- An in-flight guard and a reserved job ID stop retries from creating duplicate
  leads. A photo upload failure after a successful save is reported separately.
- **Quote Pending to Send** from a CS user files a quote approval request
  (`request_quote_approval`); the lead is created as Waiting Complete Details.
  Admin and CS Admin set the status directly.
- **Urgent** from CS, CS Admin or Admin creates the lead in its ordinary status
  first, then runs `check-urgent-lead`. Clean: the verification is recorded and the
  lead becomes urgent. Issues (corrections, missing details): shown in the panel and
  reviewed on the saved lead in the CRM. Unavailable: nothing was compared; it is
  never treated as a pass. Processors set Urgent directly. Urgent never changes the
  customer's agreed schedule.

Processor and Operator roles cannot create leads; the database enforces this.

## Check an existing lead and update its schedule

Click **Check Lead** to list active CRM leads with the same customer phone. Select
one, enter the new **Schedule Note** and click **Update**. This replaces that lead's
schedule requirement instead of creating a duplicate, then clears the draft.

## Activity & Reports

Lists the leads you created with Donut for Today, Yesterday, Last 7 Days, Last 30
Days or a custom range, with totals. **Export** downloads the visible leads as CSV.

## Technician Intelligence (Admin and Processor)

**Find captured technician** matches the technician by the chat's phone number.
**Review technician** calls the same `technician-chat-assessment` Edge Function as
the CRM and shows suggested labels with verified chat evidence and job counts.
**Save reviewed labels** keeps the labels you confirm. AI advice never changes a
technician's Good Tech or active flag; that goes through the CRM's Tech Approvals.
**Open full Processing Workflow** opens the CRM for map selection, batches of up to
8 and flag requests. Admins also get a link to Lead Coverage analytics. Other roles
do not see this panel and cannot call the API.

## Send photos to tech (started in the CRM)

On a saved lead, the CRM's **Send photos to tech** uses Donut to attach the
original photos to the assigned technician's Quo conversation on the technician
line. It requires Tech Quick Chat permission and technician-detail access. Review
the attachments in Quo and click **Send** yourself; the handoff is not delivery.
Existing text drafts are kept. Batches over 30 MB, or a Quo page where the file
input cannot be identified, fail visibly; use the CRM's **Copy all N photos**
(one numbered combined image) and paste instead.

## Updates

The side panel and Options show the installed version and release date/time, and
show a notice when the CRM's `/extension-release.json` has a newer version. The
CRM header's Donut button shows the latest and installed versions (older builds
without the version handshake show **Not detected**).

To update, extract the new ZIP over the existing `quo-crm-extension` folder
(same path), click **Reload** on Donut in `chrome://extensions`, and refresh CRM
and Quo tabs. If you use a new folder, **Load unpacked** it and remove the old copy.
Updates are never installed automatically.

## Developer notes

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: Quo content script, CRM bridge, side panel, options |
| `background.js` | Service worker: Supabase session, lead save, checks, photo upload |
| `content.js` / `content.css` | Selection menu and photo handoff on Quo pages |
| `crm-bridge.js` | Relays CRM page messages (version handshake, photo handoff) |
| `sidepanel.*` | Lead capture form, reports, sign-in |
| `technician-workflow.js` | Technician Intelligence panel |
| `options.*` | CRM Website URL and theme |
| `release-status.*` | Installed version and update notice |
| `supabase.js` | Bundled Supabase client |
| `data/npa-nxx.json` | NANPA rate-center lookup (see `data/README.txt`) |
| `release.json` | Generated release metadata; do not edit |

For every change in this folder, from the CRM repository root:

```sh
npm run extension:release -- <higher-version> "Release notes"
npm run extension:check
```

This updates `manifest.json`, `release.json`, `public/extension-release.json` and
`public/Donut.zip` together; commit them with the source. Never package the ZIP by
hand or reuse a version. `npm run build` runs the check and rejects unpackaged
changes. Users receive a release only after the CRM is published and they reload
Donut.
