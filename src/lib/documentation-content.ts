// Structured content for the CRM documentation.
// Rendered on-screen and exported to PDF from the Settings > Documentation tab.
//
// Role, status and permission lists are generated from the same constants the app
// enforces, so they cannot drift from the code. Hand-written tables are checked for
// completeness in documentation-content.test.ts.

import { getDefaultVisibleStatuses } from "@/lib/access";
import { ALL_LEAD_STATUSES, STATUS_LABELS, getChangeableStatuses } from "@/lib/constants";
import type { AppRole, LeadStatus } from "@/types";

export type DocBlock =
  | { type: "p"; text: string; italic?: boolean }
  | { type: "bullet"; text: string }
  | { type: "kv"; label: string; value: string }
  | { type: "table"; headers: string[]; rows: string[][] };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export const DOC_TITLE = "Marshmallow";
export const DOC_SUBTITLE = "Complete System Documentation";
export const DOC_VERSION = "Version 2.0 · November 2026";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  cs_admin: "CS Admin",
  customer_service: "CS",
  processor: "Processor",
  opr: "OPR",
  opr_admin: "OPR Admin",
};

const DOC_ROLES: AppRole[] = ["admin", "cs_admin", "customer_service", "processor", "opr", "opr_admin"];

export const STATUS_MEANINGS: Record<LeadStatus, string> = {
  waiting_complete_details: "Lead created; details from the customer are still missing.",
  urgent_job: "Dispatch priority. Sorts high, raises Urgent alerts, and goes through the urgent check for CS. Never changes the agreed schedule.",
  quote_sent_waiting: "Quote delivered to the customer; waiting for a reply.",
  post_visit_quote_sent_waiting: "Technician visited and a quote was sent; waiting on the customer.",
  post_visit_confirmation: "Technician visited; CS confirms the visit and whether the customer wants to proceed.",
  activate_customer: "Customer is ready to go ahead; move toward scheduling. Pinned for the lead's creator and CS Admins.",
  quote_sent_need_follow_up: "Customer has not replied to the quote; CS follow-up needed.",
  needs_quote: "Pricing is needed before a quote can be built.",
  tech_making_quote: "A technician is preparing the quote.",
  quote_change: "The quote was revised mid-quote.",
  waiting_customer_response: "Waiting for information from the customer.",
  need_tech: "A technician must be found and assigned. Raises Need Tech alerts.",
  scheduled: "Visit booked.",
  job_in_progress: "Technician is doing the job. Admins and Processors get a Job in Progress alert.",
  needs_reschedule: "The visit fell through and must be rebooked.",
  job_done: "Work complete; the business's share is now due.",
  payment_pending: "Waiting for the technician to send the business's share.",
  cancellation_requested: "A cancellation request is waiting for review. Set by the workflow only.",
  cancelled: "Cancelled. Sorts to the bottom of the list.",
  paid: "Final. Only Admin (or a server-side service_role job) can set it, and it can never change again.",
  partial_paid: "Part of the payment received; balance outstanding.",
  payment_requested: "A Paid request is waiting for Admin approval. Set by the workflow only.",
  scammed: "Fraudulent lead.",
  pending_to_send: "Quote request approved; waiting in Quotes to Send for a Quotation Master.",
  quote_updated: "The quote is ready; pinned to the top for the person who requested it and for CS Admins.",
};

const statusLabelList = (statuses: Iterable<LeadStatus>) => {
  const list = [...statuses].map((status) => STATUS_LABELS[status]);
  return list.length ? list.join(", ") : "None (read-only).";
};

const hiddenStatusList = (role: AppRole) => {
  const visible = getDefaultVisibleStatuses(role);
  const hidden = ALL_LEAD_STATUSES.filter((status) => !visible.has(status));
  return hidden.length ? statusLabelList(hidden) : "None";
};

export const NAV_ACCESS_ROWS: string[][] = [
  ["leads", "All Leads", "Every role"],
  ["schedule", "Schedule", "Admin, CS Admin, CS, Processor"],
  ["processor_board", "Processor Board", "Admin and Processor only (fixed)"],
  ["map_view", "Map View", "Admin, Processor"],
  ["quo_monitor", "QUO Inbox", "Admin by default; grantable per user"],
  ["ai_assistance", "AI Assistance (Missed-Lead Tracker)", "Admin, CS Admin, CS only (fixed)"],
  ["notifications", "Notifications", "Admin, Processor, CS Admin, CS (fixed)"],
  ["cancellation_requests", "Cancellation Requests", "Admin and Processor always; grantable to others"],
  ["payment_requests", "Paid Approval Pending", "Admin only (fixed)"],
  ["quote_approval_requests", "Quote Approval", "CS Admin, CS; grantable per user (only Admin and CS Admin can approve)"],
  ["quote_pending_requests", "Quotes to Send", "Admin and Quotation Masters (fixed)"],
  ["technician_change_requests", "Tech Approvals", "Admin by default; grantable per user"],
  ["urgent_review_requests", "Urgent Review", "Admin, CS Admin; grantable per user"],
  ["cx_updates", "Get CX Update / Get Tech Update", "Admin, Processor, CS Admin, CS (fixed)"],
  ["technicians", "Technicians", "Admin, Processor; grantable (e.g. OPR Admin)"],
  ["areas", "Area Insights", "Admin by default; grantable per user"],
  ["optimization", "Optimization", "Admin only (fixed)"],
  ["analytics", "Analytics", "Admin by default; grantable per user"],
  ["cs_team_performance", "CS Team Performance", "Admin by default; grantable on its own (opens Analytics with only this section)"],
  ["activity_logs", "Activity Logs", "Admin by default; grantable per user"],
  ["settings", "Settings", "Admin; CS Admin with Can Manage Users sees the Users tab only (fixed)"],
  ["quick_chat", "Quick Chat (customer)", "Admin; others when granted. Enforced by can_use_quick_chat()"],
  ["tech_quick_chat", "Tech Quick Chat", "Granted per user; hidden from CS Admin. Enforced by can_use_quick_chat()"],
];

export const TAG_ROWS: string[][] = [
  ["ready_to_schedule", "Ready to schedule", "Admin, CS Admin, CS, Processor"],
  ["confirmation_sent", "Customer Require New Schedule", "Admin, CS Admin, CS"],
  ["waiting_schedule_confirmation", "Waiting for CX for schedule confirmation", "Admin, CS Admin, CS, Processor"],
  ["booked", "Booked", "Admin, CS Admin, CS"],
  ["incomplete_details", "Incomplete details", "Admin, Processor, Quotation Masters"],
];

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "1. Overview",
    blocks: [
      { type: "p", text: "Marshmallow is the internal CRM for a home-services business. Customers reach the business by call or text through Quo (formerly OpenPhone). The team turns those conversations into leads, quotes the work, assigns a technician, schedules the visit, follows the job, and confirms the business has received its share of the payment." },
      { type: "p", text: "Every permission is enforced in five layers: the UI, the frontend permission helpers (src/lib/access.ts and AuthContext.canAccess), database Row Level Security, Edge Function / RPC authorization, and the generated database types. Hiding a button is never the security boundary." },
      { type: "p", text: "Important changes go through approval queues instead of direct edits: quotes, payments, cancellations, urgent jobs and technician flag changes. AI features are advisory only; they never change a status or approve anything." },
      { type: "p", text: "Donut, a Chrome extension installed manually from Donut.zip, works inside Quo and uses the same backend as the CRM. A feature that exists in both must be kept the same in both." },
    ],
  },
  {
    id: "roles",
    title: "2. User Roles",
    blocks: [
      { type: "p", text: "Six roles exist. A user's role lives in the user_roles table (never on the profile) and is checked through the SECURITY DEFINER function public.has_role()." },
      {
        type: "table",
        headers: ["Role", "Purpose", "Creates leads in the CRM"],
        rows: [
          ["Admin", "Full control. The only role that approves payments and marks a lead Paid.", "Yes"],
          ["CS Admin", "Leads the customer-service team; reviews quote and urgent requests. Never sees technician details.", "Yes"],
          ["CS", "Talks to customers, creates and quotes leads, requests urgent review.", "Only with the Manual Lead grant; otherwise through Donut"],
          ["Processor", "Dispatch: finds and assigns technicians, follows jobs, handles cancellations, records Paid requests.", "No"],
          ["OPR", "Operator working with their own technicians. Read-only leads; cannot change status or tags.", "No"],
          ["OPR Admin", "OPR with wider technician management when Technicians is granted.", "No"],
        ],
      },
      { type: "p", text: "Per-user switches that sit beside the role: Quotation Master (Quotes to Send queue), Manual Lead (New Lead button and Ctrl/Cmd+N, for CS), Tech Report, Copy Details, Can Manage Users (CS Admin) and an immutable OPR code that scopes which technicians an operator sees." },
    ],
  },
  {
    id: "nav-permissions",
    title: "3. Tab Permissions (Navigation Access)",
    blocks: [
      { type: "p", text: "Sidebar access combines a role default with per-user overrides in navigation_permissions, edited in Settings > Feature Access. Admin always sees every tab. Rows marked fixed ignore overrides. A user's own overrides are re-read when they return to the CRM tab, so a change applies without signing out." },
      { type: "table", headers: ["Nav key", "Page", "Access"], rows: NAV_ACCESS_ROWS },
      { type: "p", text: "Need Attention is a virtual Review item for Admin, CS Admin and CS (section 7). CRM Updates lives in Settings > CRM Updates for Admin. The Documentation tab is Admin-only." },
    ],
  },
  {
    id: "status-visibility",
    title: "4. Status Visibility & Change Permissions",
    blocks: [
      { type: "p", text: "Two independent rules decide what a user can do with statuses. Being able to see a status never means being able to set it." },
      { type: "kv", label: "Visibility (read)", value: "Which statuses appear in the By Status list and lead queries. Role default plus per-user lead_status_visibility overrides (Settings > Status Visibility)." },
      { type: "kv", label: "Change (write)", value: "Which statuses a user can move a lead into. Fixed per role in STATUS_CHANGE_ACCESS (src/lib/constants.ts); there are no per-user change overrides." },
      {
        type: "table",
        headers: ["Role", "Statuses hidden by default"],
        rows: DOC_ROLES.map((role) => [ROLE_LABELS[role], role === "opr" || role === "opr_admin" ? `Everything except ${statusLabelList(getDefaultVisibleStatuses(role))}` : hiddenStatusList(role)]),
      },
      { type: "p", text: "Statuses each role may set:" },
      ...DOC_ROLES.map((role): DocBlock => ({ type: "kv", label: ROLE_LABELS[role], value: statusLabelList(getChangeableStatuses(role)) })),
      { type: "p", text: "A Processor choosing Paid submits a Paid request (Paid Approval Pending) rather than setting Paid." },
      { type: "p", italic: true, text: "Database enforcement: the enforce_paid_status_rules trigger stops any status change on a Paid lead, for every caller including Admin, and only Admin or a server-side service_role caller can move a lead into Paid. Other fields on a Paid lead can still be edited." },
      { type: "p", text: "Lead row visibility (RLS policy \"Lead visibility by role\"): Admin, Processor and OPR read every lead row (the OPR UI then shows Urgent Job only). OPR Admin reads urgent jobs plus their own non-scammed leads. CS Admin reads every lead except Paid, Partial Paid, Cancelled, Job Done and Scammed. CS reads only leads they created, are assigned to, or that were shared with them." },
    ],
  },
  {
    id: "statuses",
    title: "5. Lead Statuses (Complete Reference)",
    blocks: [
      { type: "p", text: `${ALL_LEAD_STATUSES.length} statuses exist. The normal path is Waiting Complete Details > Needs Quote / Tech Making Quote > Quote Sent - Waiting > Need Tech > Scheduled > Job in Progress > Job Done > Payment Pending > Paid Approval Pending > Paid.` },
      { type: "table", headers: ["Key", "Label", "Meaning"], rows: ALL_LEAD_STATUSES.map((status) => [status, STATUS_LABELS[status], STATUS_MEANINGS[status]]) },
    ],
  },
  {
    id: "tags",
    title: "6. Lead Tags",
    blocks: [
      { type: "p", text: "Tags are a second label on top of status that show scheduling state without changing the status. Assignment is enforced by the enforce_lead_tag_role_access() trigger; operators cannot assign tags." },
      { type: "table", headers: ["Tag key", "Label", "Assignable by"], rows: TAG_ROWS },
      { type: "p", text: "Scheduling tags only affect ordering on pre-scheduling statuses. Incomplete details applies on any status and alerts the CS who created the lead and every CS Admin with a pop-up until it is fixed." },
      { type: "p", text: "AI schedule confirmation: when a lead tagged Waiting for CX for schedule confirmation gets a new text or call in Quo and the AI finds the customer confirmed (in a text or on a call), the tag becomes Ready to schedule with an AI marker (leads.cs_tag_source = ai). Any later tag change by a person removes the marker. See section 12." },
    ],
  },
  {
    id: "leads-list",
    title: "7. All Leads, Urgent Leads & Need Attention",
    blocks: [
      { type: "p", text: "All Leads shows every lead the user can see, with search by name, job ID, phone, landline, address, city, state or service, a status filter and a schedule-date filter. Order of the list:" },
      { type: "bullet", text: "Pinned first: Activate Customer for the lead's creator, Quote Updated for the quote's requester; CS Admins see both pinned." },
      { type: "bullet", text: "Then scheduling tags: Ready to schedule > Customer Require New Schedule > Waiting for CX for schedule confirmation > Booked." },
      { type: "bullet", text: "Then Urgent Job (most recently urgent first), then Need Tech, then the rest newest first. Cancelled is always last." },
      { type: "p", text: "Urgent leads box (Admin, CS Admin, CS): every urgent lead, newest first, with an AI Status label from the customer's chat (section 12). Refresh AI Status re-reads every urgent chat on demand, at most once a minute." },
      { type: "p", text: "Cx Awaiting Response box: urgent leads whose customer sent the last message in Quo, so the customer is waiting on us. Rule-based, no AI." },
      { type: "p", text: "Need Attention (Admin, CS Admin, CS; no AI): urgent jobs whose schedule requirement text names a date that is today or already past. Requirements without a date never qualify, and a date with no year more than about 180 days back is treated as next year. Urgent leads within 50 miles (or in the same city) of each other show a nearby-urgent notice." },
    ],
  },
  {
    id: "lead-detail",
    title: "8. Lead Card & Lead Detail",
    blocks: [
      { type: "p", text: "Cards and the detail page show the job ID, status, customer, phone (Quo call/text shortcut), address, service, schedule, tag, coverage badge, notes, photos and actions allowed for the role: change status, tag, request quote approval, cancellation or payment, CX / Tech update, Quick Chat, share (Admin), delete (Admin) and status history." },
      { type: "p", text: "Copy Complete Details copies Service Details, Address, Schedule Requirement and Quote (the quote is left blank where the viewer may not see it). Each user's Copy Details switch is in Settings > Feature Access. Photos can be viewed, copied as one numbered combined image, or handed to the assigned technician's Quo chat through Donut; the user still presses Send in Quo." },
      {
        type: "table",
        headers: ["Notes thread", "Who writes", "Who reads"],
        rows: [
          ["General", "Everyone with the lead", "Everyone with the lead"],
          ["CS", "Admin, CS Admin, CS", "Admin, CS Admin, CS, Processor, OPR, OPR Admin"],
          ["Processor", "Admin, Processor", "Admin, Processor"],
          ["OPR", "Admin, Processor, OPR, OPR Admin", "Admin, Processor, OPR, OPR Admin"],
        ],
      },
      { type: "p", text: "Technicians are recorded in the processor notes thread as numbered lines (\"Tech 1: name - number - note\"). CS Admins never see technician details (canSeeTechDetails)." },
    ],
  },
  {
    id: "creation",
    title: "9. Lead Creation & Sharing",
    blocks: [
      { type: "p", text: "Leads are created from Quo chats with Donut, or with the New Lead button by Admin, CS Admin and CS users holding the Manual Lead grant (enforced in the leads INSERT policy through can_create_manual_lead()). Duplicate phone numbers are blocked while typing." },
      { type: "p", text: "Find Address uses the authenticated geocode-lead-address Edge Function, which accepts US Census coordinates only. Apartment / unit numbers are preserved, and city/ZIP approximations are never saved as a lead's map point. The lead form also shows the five largest nearby populated places from us_places." },
      { type: "p", text: "Admin can share a lead with a CS user (lead_shares); the user is notified and can then see it." },
    ],
  },
  {
    id: "approvals",
    title: "10. Approval Workflows",
    blocks: [
      { type: "kv", label: "Quote approval", value: "CS choosing Pending to Send creates a request in Quote Approval; the lead keeps its status. Admin or CS Admin approves (lead moves to Quote Pending to Send for Quotation Masters) or declines (lead stays where it was). When the quote is ready the lead becomes Quote Updated and is pinned for the requester." },
      { type: "kv", label: "Cancellation", value: "A user submits a reason and optional proof image; the lead becomes Cancellation Pending and its previous status is stored. AI can suggest a reason (section 12). Admin or Processor reviews a request; a Processor's own request needs Admin. Approve: Cancelled. Reject: previous status." },
      { type: "kv", label: "Payment", value: "A Paid request carries the amount, an optional screenshot and a comment; the lead becomes Paid Approval Pending. Only Admin approves (the lead becomes Paid, permanently) or rejects (previous status). Admin can mark an area for Optimization while approving." },
      { type: "kv", label: "Urgent review", value: "When CS, CS Admin or Admin makes a lead Urgent, the urgent check runs first (section 12). Processors set Urgent directly. A clean result proceeds; issues send it to Urgent Review for a CS Admin, who cannot approve their own request; unavailable must be acknowledged and is logged as urgent_unverified_acknowledged. The database gate in 20261104000000_urgent_review_gate.sql enforces that a check happened." },
      { type: "kv", label: "Technician changes", value: "Processors cannot change a technician's Good Tech or active flag directly. They request it (request_technician_change); Admin approves in Tech Approvals, or declines with a reason." },
    ],
  },
  {
    id: "updates",
    title: "11. CX & Tech Update Requests",
    blocks: [
      { type: "p", text: "Get CX Update: Admin or Processor asks the customer side for news on a lead; the assigned CS (or the creator when unassigned) and CS Admins answer. Get Tech Update: CS or CS Admin asks the technician side; the Processor answers and Admin can monitor." },
      { type: "p", text: "The requester can Acknowledge an answer or Question More; the thread history is kept. Requests go through the authenticated cx-update-requests Edge Function, and all checks live in the database RPC." },
    ],
  },
  {
    id: "ai",
    title: "12. AI Features",
    blocks: [
      { type: "p", text: "All AI features use OpenAI gpt-4o-mini through Edge Functions; the key is the OPENAI_API_KEY Edge Function secret and never reaches the browser. Customer and technician chat text is treated as untrusted data. AI output is advisory: it never changes a status, approves a request or sends a message. If a check cannot run, it reports unavailable, never passed." },
      {
        type: "table",
        headers: ["Feature", "Where", "What it does"],
        rows: [
          ["Urgent check (check-urgent-lead)", "Making a lead Urgent (CRM and Donut)", "Compares the saved lead with the whole customer conversation and the latest agreement. Suggests fixes to customer name, service type, service details and quote, each with the customer's exact words; every fix must be applied or dismissed. Address corrections come from Google geocoding, not the AI."],
          ["AI Status (refresh-urgent-statuses)", "Urgent leads box", "Short label from the customer chat: Awaiting Response, Awaiting Schedule, Schedule Confirmed, Schedule Confirmation Pending, New Schedule, Quote Rejected, Need to Cancel, Need Requote, or Needs Review. Runs every 30 minutes for changed chats; obvious cases use rules without AI."],
          ["Cancellation reason (suggest-cancellation-reason)", "Cancellation form", "Reads the last 30 messages and suggests one reason: Customer Declined Quote, Customer Unreachable, Found Another Provider, Out of Service Area, Duplicate Lead, Job Not Needed, Scheduling Conflict or Other. Gives up after 3 seconds."],
          ["Processing Workflow (technician-chat-assessment)", "Technicians, Map View, Donut Technician Intelligence (Admin, Processor)", "Reads up to 8 technicians' recent Quo messages and suggests labels (good tech, doesn't respond, never responded, late payment, high rates, doesn't cooperate, rude, paid us before, scammer) with verified quotes. Flags change only through Tech Approvals."],
          ["Processor Board (processor-board)", "Processor Board", "Reads the technician chat for each assigned job and saves facts; the database turns them into the board status (section 13)."],
          ["Schedule confirmation (schedule-confirmation-monitor)", "Leads tagged Waiting for CX for schedule confirmation", "Runs after any new text (ours or the customer's), call, call transcript or call summary in the matched Quo chat. Reads texts and the speaker-labelled call lines in context, so indirect replies count too (a bare ‘ok’ or a spoken ‘yeah’ right after our team states the time, picking one of our offered times, ‘I’ll leave the gate open’, ‘see you then’); questions, hedges and reschedule requests do not. If the customer confirmed (in a text or on a call), the tag changes to Ready to schedule (marked AI) and the lead's CS, CS Admins, Admins and Processors get a pop-up with job ID, customer, service, location, schedule and the customer's words. The database checks the quote is the customer's own words (a text or their side of a call; never our team or a call summary), the job is still open with no pending approval, and only one waiting job matches the customer. Admin turns it Off / Shadow / On under Notifications."],
        ],
      },
      { type: "p", text: "AI Assistance and Need Attention do not use AI; they are rule-based lists. Marshmallow Copilot is paused pending testing (section 21)." },
    ],
  },
  {
    id: "processor-board",
    title: "13. Processor Board",
    blocks: [
      { type: "p", text: "Admin and Processor only. Every lead with a technician that is not Paid, Partial Paid, Cancelled or Scammed, newest lead first. Rules read the team's standard technician-chat steps (customer details sent, took the job, done, share requested / sent / received); AI reads call transcripts and free-form replies. Payment here means the technician sending the business's share." },
      {
        type: "table",
        headers: ["Board status", "Meaning"],
        rows: [
          ["Wrong Tech Number", "Technician number missing or not a valid 10-digit number. Shown first; never sent to AI."],
          ["Upcoming", "The visit has not happened yet."],
          ["Take Job Update", "The appointment has passed; ask the technician for an update."],
          ["Job In Progress", "The technician is still working (parts, return visit)."],
          ["Not enough details", "The chat does not say enough."],
          ["Payment Pending", "Done and unpaid for under 3 days, or the share is reported sent and needs verifying before marking Paid."],
          ["Send Dose", "Done but the share has not arrived more than 3 days after the scheduled time; remind the technician."],
        ],
      },
      { type: "p", text: "Checks run only on the server: after a lead change or new technician message, for jobs never checked, and daily for done-but-unpaid jobs. Opening the board never runs AI; Review shows the evidence and timeline, and Check again re-checks one job." },
    ],
  },
  {
    id: "ai-assistance",
    title: "14. AI Assistance (Missed-Lead Tracker)",
    blocks: [
      { type: "p", text: "A rule-based start-of-shift worklist for Admin, CS Admin and CS (list_cs_missed_followups). A Quo conversation is listed when it is on a CS number (the technician line is excluded), the customer messaged last and nobody has replied since, and the last customer message falls in the chosen window (default last 24 hours; also Today, Yesterday, Last 7 days, All, Custom). Times are US Eastern." },
      { type: "bullet", text: "Missed call: the customer's latest inbound call was not answered. Answered calls are not listed." },
      { type: "bullet", text: "Unanswered text: the customer's last message has no reply." },
      { type: "bullet", text: "New lead: we have never replied to this number." },
      { type: "p", text: "Longest-waiting first. An item clears when an agent replies or someone marks it handled, and returns if the customer writes again." },
    ],
  },
  {
    id: "quo",
    title: "15. QUO Inbox & Quick Chat",
    blocks: [
      { type: "p", text: "Quo is mirrored into the CRM; there is no AI in the inbox. quo-webhook verifies each request signature and upserts conversations and messages; quo-reconcile-sync, quo-sync-contacts and quo-sync-history are safety-net backfills. An existing conversation-to-lead link is never replaced." },
      { type: "p", text: "Conversations have their own triage status: Raw, Spam, Contacted, Qualified Lead, Rejected, Successfully Completed. The Webhook Active / Paused button stops or resumes ingestion (quo_webhook_ingestion_paused in quo_ai_settings, which is now a general settings store)." },
      { type: "p", text: "Quick Chat (customer) and Tech Quick Chat open the conversation from a lead. Typed messages are queued in quo_outbound_messages and sent by the extension; access is enforced by can_use_quick_chat() on that table." },
    ],
  },
  {
    id: "notifications",
    title: "16. Notifications & Pop-ups",
    blocks: [
      { type: "p", text: "The bell and the Notifications page show the user's own notifications; reading one does not complete the work. Sounds are configurable there." },
      { type: "bullet", text: "Urgent Job and Need Tech: Admin, Processor and CS Admin, plus users tied to the lead (creator, assigned CS, shares, assigned operators)." },
      { type: "bullet", text: "Job in Progress: Admin and Processor." },
      { type: "bullet", text: "Quote Updated: the quote requester and CS Admins. Incomplete Details: the lead's CS and CS Admins." },
      { type: "bullet", text: "Operator hold alerts: OPR and OPR Admin, when an urgent job becomes Ready to schedule, Waiting for CX for schedule confirmation, Scheduled or Cancelled." },
      { type: "bullet", text: "Approval requests notify their reviewers; reviews notify the requester. CRM Updates are one-time announcements to chosen roles." },
    ],
  },
  {
    id: "schedule-map",
    title: "17. Schedule & Map View",
    blocks: [
      { type: "p", text: "Schedule shows booked work by day, week or custom range. CS Admins do not see technician details there." },
      { type: "p", text: "Map View (Leaflet) shows technicians and urgent leads. Selecting a technician lists urgent leads within 20 miles; selecting several opens Processing Workflow. Lead points come only from saved Census coordinates; technician and area searches use OpenStreetMap Nominatim in the browser." },
    ],
  },
  {
    id: "technicians",
    title: "18. Technicians",
    blocks: [
      { type: "p", text: "Tabs: Directory, OPR Report, Tech Report (per-user grant) and Processing Workflow. Admin and Processor see every technician; OPR Admin sees technicians with an OPR code; OPR sees only their own code." },
      { type: "bullet", text: "Add: Admin, Processor, OPR, OPR Admin. Import (CSV/XLSX) and delete: Admin, Processor, OPR Admin." },
      { type: "bullet", text: "Export anywhere in the app is Admin-only." },
      { type: "bullet", text: "Good Tech and active flags change only through Tech Approvals." },
    ],
  },
  {
    id: "insights",
    title: "19. Area Insights, Optimization & Analytics",
    blocks: [
      { type: "p", text: "Area Insights: totals, closure and cancel rates, top cities and services, a status breakdown, cross-tab and ranking for 7 days, 30 days, 90 days or a year." },
      { type: "p", text: "Optimization (Admin only): areas ranked on jobs that actually closed; mark an area to track it afterwards." },
      { type: "p", text: "Analytics: Operations Performance (daily intake, conversion funnel, open-lead aging, pipeline, CS agent performance, top services and sources), Lead Coverage & Sources (Admin) and CS Team Performance (leads added per CS / CS Admin and how far they progressed)." },
    ],
  },
  {
    id: "admin",
    title: "20. Settings, Activity Logs & Data",
    blocks: [
      { type: "kv", label: "Users", value: "Create users, set role and password, OPR code, access codes, set up or reset 2FA, delete (through the admin-users Edge Function). Deleting a user keeps history: leads are unassigned and their id is cleared from logs and notes." },
      { type: "kv", label: "Feature Access / Status Visibility", value: "Per-user tab switches and per-user visible statuses." },
      { type: "kv", label: "Templates", value: "Copy Technician Message and Reminder Message texts, filled from the lead." },
      { type: "kv", label: "CRM Updates", value: "One-time announcements to chosen roles; receipts in crm_update_receipts." },
      { type: "kv", label: "Google Sheets", value: "The Sheets copy of leads: transactional outbox, retries, full rebuild and health watchdog (google-sheets-sync)." },
      { type: "kv", label: "Documentation", value: "This reference, a PDF export, and Sync Population Data, which refreshes us_places from the Census (run yearly)." },
      { type: "p", text: "Activity Logs record create, update, status change, note, share, request, approval and delete actions with the actor's name, in plain English." },
    ],
  },
  {
    id: "paused",
    title: "21. Paused or Not Yet Live",
    blocks: [
      { type: "bullet", text: "Marshmallow Copilot (read-only assistant): paused in the database pending testing; do not re-enable without testing. See docs/COPILOT_ROLLOUT.md." },
      { type: "bullet", text: "AI schedule confirmation: live since 2026-11-05 (both migrations applied, worker deployed, one-minute schedule running, mode Automatic). See docs/WORKFLOW_INBOX_ROLLOUT.md." },
      { type: "bullet", text: "Code changes reach users only after CRM Publish; migrations are applied by hand in the Supabase SQL editor and Edge Functions are deployed separately. See docs/HANDOVER.md for items recorded as awaiting these steps." },
    ],
  },
  {
    id: "donut",
    title: "22. Donut Chrome Extension",
    blocks: [
      { type: "p", text: "Installed with Chrome's Load unpacked from Donut.zip (not the Chrome Web Store). The CRM header Donut button shows the latest and installed versions; to update, replace the folder, click Reload, and refresh CRM and Quo tabs." },
      { type: "bullet", text: "Create a lead from highlighted Quo chat text; nothing is sent unless selected. Check Lead updates an existing lead's schedule requirement." },
      { type: "bullet", text: "Find Address and coverage preview through geocode-lead-address (Census only); urgent check through check-urgent-lead." },
      { type: "bullet", text: "Technician Intelligence for Admin and Processor through technician-chat-assessment." },
      { type: "p", text: "Shared features must stay identical in both clients (docs/CRM_EXTENSION_PARITY.md). Every extension change is packaged with npm run extension:release." },
    ],
  },
  {
    id: "security",
    title: "23. Security & Authentication",
    blocks: [
      { type: "bullet", text: "Supabase Auth email and password, optional TOTP two-factor authentication, and a 6-digit access code at sign-in for non-admin users who have one set." },
      { type: "bullet", text: "RLS on every table; roles in user_roles checked with has_role()." },
      { type: "bullet", text: "Secrets (service role, OpenAI, Quo, webhook, Google) live only in Edge Function secrets, never in the browser, VITE_ variables, Donut or git." },
      { type: "bullet", text: "Quo webhooks are signature-checked. The lead-photos bucket is private; photos load through short-lived signed URLs." },
    ],
  },
  {
    id: "tech",
    title: "24. Technical Stack",
    blocks: [
      {
        type: "table",
        headers: ["Layer", "Technology"],
        rows: [
          ["Frontend", "React 18, Vite 5, TypeScript, Tailwind CSS 3, shadcn/ui, Framer Motion"],
          ["Data", "TanStack Query, Supabase JS client, shared Realtime bus (src/lib/realtime.ts)"],
          ["Backend", "Supabase Postgres + RLS, Auth, Storage, Realtime, Edge Functions (Deno)"],
          ["Hosting", "Lovable; users receive changes only after Publish"],
          ["AI", "OpenAI gpt-4o-mini through Edge Functions"],
          ["Maps and geo", "Leaflet, US Census geocoder for lead points, Nominatim for technician and area search, PostGIS + us_places"],
          ["Telephony", "Quo / OpenPhone webhooks and API"],
          ["Testing", "Vitest + Testing Library, mocked Playwright specs, hand-run SQL harnesses in supabase/tests"],
        ],
      },
    ],
  },
];
