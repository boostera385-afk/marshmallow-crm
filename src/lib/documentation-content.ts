// Structured content for the CRM documentation.
// Rendered on-screen and exported to PDF from the Settings > Documentation tab.

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
export const DOC_VERSION = "Version 1.1 · September 2026";

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "1. Overview",
    blocks: [
      { type: "p", text: "Marshmallow is a lead management system for a home-services operation. It tracks a lead from first contact through quote, scheduling, job execution, and payment. The app is a React 18 + Vite 5 + Tailwind SPA on top of Supabase (Postgres, RLS, Storage, Edge Functions, Realtime)." },
      { type: "p", text: "The system is opinionated: statuses, tags, and role permissions are enforced both in UI and at the database layer. Every mutation writes an audit trail, and both updated_at and last_edited_at are always synchronised." },
    ],
  },
  {
    id: "roles",
    title: "2. User Roles & Permissions",
    blocks: [
      { type: "p", text: "Five roles exist. Roles live in a dedicated user_roles table (never on the profile) and are checked via the SECURITY DEFINER function public.has_role() to avoid RLS recursion." },
      {
        type: "table",
        headers: ["Role", "Purpose", "Can create leads", "Default nav"],
        rows: [
          ["admin", "Full system control, approvals, reviews.", "Yes", "All pages"],
          ["customer_service (CS)", "First contact, quoting, follow-up with customer.", "Only with the Manual Lead Addition grant", "Leads, Schedule, Quote Approval"],
          ["cs_admin", "Supervises CS work; restricted pages and Processor Details hidden.", "Yes", "Leads, Schedule, Quote Approval"],
          ["processor", "Backend processing, tech assignment, payment.", "No", "Leads, Schedule, Cancellation Requests, Map View, Technicians"],
          ["opr", "Operator with a strictly narrow view.", "No", "Leads only (urgent_job + partial_paid)"],
          ["opr_admin", "OPR Admin: manages technicians across OPRs. Default access mirrors OPR.", "No", "Leads only; Technicians granted per user"],
        ],
      },
      { type: "p", italic: true, text: "Admin and CS Admin can always create leads manually. A CS user needs the per-user \"Manual Lead Addition\" grant (profiles.can_add_manual_leads) from Settings; without it the New Lead button and the Ctrl/⌘N command are hidden and they add leads through the Chrome extension instead. Admins can grant additional pages per user via navigation_permissions. 'no_role' is never offered in the role picker." },
      { type: "p", text: "Sidebar visibility is computed from the role default plus per-user overrides in navigation_permissions. Admin bypasses all checks. payment_requests is admin-only." },
      { type: "p", text: "Quotation Master is a per-user flag (profiles.is_quotation_master), not a role. It grants access to the \"Quote Pending to Send\" queue alongside Admins. CS Admins are not Quotation Masters: the queue is hidden from them and they are not alerted when a lead becomes Pending to Send." },
      { type: "p", text: "CS Admin restrictions: Processor Details (tech name/number, financial split) and processor-only workflows are hidden in the Lead Detail Panel." },
    ],
  },
  {
    id: "nav-permissions",
    title: "3. Tab Permissions (Navigation Access)",
    blocks: [
      { type: "p", text: "Sidebar tab visibility is a two-layer system: a hard-coded role default, plus per-user overrides stored in the navigation_permissions table. Admin bypasses every check and always sees every tab. The check runs through canAccessNavItem(role, navItem, permissions) in src/lib/access.ts. A signed-in user's own overrides are re-read when they return to the CRM tab (at most every 30 seconds), so a grant or removal shows without signing out; a page reload also applies it." },
      {
        type: "table",
        headers: ["Nav key", "Page", "Default access"],
        rows: [
          ["leads", "All Leads", "Admin, CS, CS Admin, Processor, OPR, OPR Admin"],
          ["schedule", "Schedule", "Admin, CS, CS Admin, Processor"],
          ["map_view", "Map View", "Admin, Processor"],
          ["technicians", "Technicians", "Admin, Processor; OPR Admin when granted per user"],
          ["optimization", "Optimization", "Admin only (hard-locked, cannot be granted)"],
          ["cancellation_requests", "Lead Cancellation Requests", "Admin, Processor"],
          ["payment_requests", "Paid Approval Pending", "Admin only (hard-locked, cannot be granted)"],
          ["quote_approval_requests", "Quote Approval", "CS and CS Admin by default; Admin can override per user"],
          ["quote_pending_requests", "Quotes to Send", "Admin and Quotation Masters"],
          ["quo_monitor", "Quo AI Assistant", "Admin by default; Admin can override per user"],
          ["quick_chat", "Quick Chat", "Admin by default; Admin can override per user"],
          ["tech_quick_chat", "Tech Quick Chat", "For Technicians, OPR and OPR Admin; enforced by can_use_quick_chat()"],
          ["analytics", "Analytics", "Admin only by default"],
          ["cs_team_performance", "CS Team Performance", "Admin only by default; opens Analytics with only this section (team-wide counts) even when Analytics is off"],
          ["areas", "Area Insights", "Admin only by default"],
          ["activity_logs", "Activity Logs", "Admin only by default"],
          ["settings", "Settings", "Admin only by default"],
        ],
      },
      { type: "p", text: "Override rules:" },
      { type: "bullet", text: "Admin can grant a non-admin user access to Analytics, Area Insights, Activity Logs, Schedule, or Cancellation Requests by inserting an allowed=true row in navigation_permissions for that user + nav_section." },
      { type: "bullet", text: "Admin can revoke a default-granted tab by inserting an allowed=false row." },
      { type: "bullet", text: "payment_requests ignores overrides entirely — it short-circuits to false for anyone who is not Admin. quo_monitor does not: it is Admin by default, and an allowed=true row in navigation_permissions grants it to a specific user." },
      { type: "bullet", text: "Manual Lead Addition is not a nav key. It is the profiles.can_add_manual_leads flag, toggled from the Manual Lead column in this Feature & Navigation Access table. Because that table is rendered only for Admin, a CS Admin holding can_manage_users can still be given the ability to grant this flag - the set_can_add_manual_leads() RPC permits it - but has no UI control for it, so in practice an Admin performs the grant. It unlocks the New Lead button and the Ctrl/⌘N command for Customer Service only; the value is enforced in the leads INSERT policy through can_create_manual_lead()." },
      { type: "bullet", text: "OPR is intentionally locked to leads only; even if an override row exists, the sidebar filters by canAccess() which respects the same rule." },
      { type: "p", text: "The Documentation tab (Settings > Documentation) is rendered only when isAdmin is true and cannot be granted to non-admins." },
    ],
  },
  {
    id: "status-visibility",
    title: "6. Status Visibility & Change Permissions",
    blocks: [
      { type: "p", text: "Two independent axes control what a non-admin user can do with statuses:" },
      { type: "kv", label: "Visibility (read)", value: "Which statuses appear in the user's sidebar \"By Status\" list and in their lead queries. Controlled by role default + lead_status_visibility overrides (per user + status, allowed boolean)." },
      { type: "kv", label: "Change (write)", value: "Which statuses the user is allowed to transition a lead into. Controlled by the STATUS_CHANGE_ACCESS constant + per-user user_status_change_permissions overrides." },
      { type: "p", text: "Default visibility by role (getDefaultVisibleStatuses in src/lib/access.ts):" },
      {
        type: "table",
        headers: ["Role", "Visible statuses by default"],
        rows: [
          ["Admin", "All 25 statuses (bypasses all checks)."],
          ["CS", "All except scammed, quote_change, and the admin-only pair pending_to_send / quote_updated."],
          ["CS Admin", "All except scammed, quote_change, quote_updated, and the hidden set paid / partial_paid / cancelled / job_done."],
          ["Processor", "All 25 statuses (sees pending_to_send and quote_updated)."],
          ["OPR", "urgent_job only."],
          ["OPR Admin", "urgent_job only, same as OPR."],
        ],
      },
      { type: "p", text: "The useAllowedStatuses hook combines the role default with lead_status_visibility rows for the current user and returns the effective Set<LeadStatus>. Both the sidebar's \"By Status\" list and the URL ?status= filter honour this set — an OPR who tries to open /leads?status=paid gets the filter dropped." },
      { type: "p", text: "Change permissions layered on top of visibility (STATUS_CHANGE_ACCESS in src/lib/constants.ts). These are frontend rules; the database separately enforces the paid boundary, described below." },
      { type: "kv", label: "Admin", value: "Any status except cancellation_requested and payment_requested (those are workflow outcomes, not manual choices)." },
      { type: "kv", label: "CS", value: "need_tech, urgent_job, waiting_customer_response, waiting_complete_details, quote_sent_waiting, quote_sent_need_follow_up, needs_quote, quote_change, needs_reschedule, cancelled, partial_paid, pending_to_send, post_visit_confirmation." },
      { type: "kv", label: "CS Admin", value: "Wider than CS: need_tech, urgent_job, waiting_customer_response, waiting_complete_details, quote_sent_waiting, post_visit_quote_sent_waiting, post_visit_confirmation, activate_customer, quote_sent_need_follow_up, needs_quote, tech_making_quote, quote_change, scheduled, job_in_progress, needs_reschedule, payment_pending, cancelled, pending_to_send. Unlike CS, a CS Admin cannot set partial_paid." },
      { type: "kv", label: "Processor", value: "post_visit_quote_sent_waiting, post_visit_confirmation, activate_customer, tech_making_quote, quote_change, waiting_customer_response, scheduled, urgent_job, job_in_progress, paid, payment_pending, job_done, needs_reschedule, cancelled, partial_paid, scammed, quote_updated." },
      { type: "kv", label: "OPR", value: "partial_paid only." },
      { type: "p", text: "Admin can extend a specific user's change permissions by inserting rows in user_status_change_permissions (user + status + allowed). This is additive: it can only grant, not revoke, the role's baseline." },
      { type: "p", italic: true, text: "Locked terminal state: once a lead is set to paid, no role (including Admin) can change its status again. This is enforced by the enforce_paid_status_rules trigger, not by the UI alone. Editing other fields on a paid lead is still allowed - only a status change is rejected." },
    ],
  },
  {
    id: "statuses",
    title: "7. Lead Statuses (Complete Reference)",
    blocks: [
      { type: "p", text: "Twenty-five statuses exist. Each has a semantic color token and a stable machine key. \"Paid\" is strictly locked once set and cannot be modified again." },
      {
        type: "table",
        headers: ["Key", "Label", "Color", "Meaning"],
        rows: [
          ["waiting_complete_details", "Waiting Complete Details", "Amber", "Lead created; details missing from CX."],
          ["urgent_job", "Urgent Job", "Red", "High-priority; sorts to the top; triggers Urgent notifications."],
          ["quote_sent_waiting", "Quote Sent - Waiting", "Blue", "Quote delivered to CX; awaiting reply."],
          ["post_visit_quote_sent_waiting", "Post Visit-Quote Sent-Waiting", "Slate", "Tech visited, quote sent, waiting on CX."],
          ["post_visit_confirmation", "Post Visit Confirmation", "Teal", "Tech has visited; CS confirms the visit with CX and whether they want to proceed. Not pinned."],
          ["activate_customer", "Activate Customer", "Emerald", "CX ready to activate; move toward scheduling."],
          ["quote_sent_need_follow_up", "Quote Sent - Need Follow Up", "Orange", "CX has not responded; CS follow-up needed."],
          ["needs_quote", "Needs Quote", "Purple", "Tech pricing pending; ready for quote build."],
          ["tech_making_quote", "Tech Making Quote", "Violet", "Technician actively preparing the quote."],
          ["waiting_customer_response", "Waiting Customer Response", "Yellow", "Awaiting any information from CX."],
          ["need_tech", "Need Tech", "Indigo", "Assignment needed; triggers Need Tech alerts."],
          ["scheduled", "Scheduled", "Cyan", "Appointment booked with date/time window."],
          ["job_in_progress", "Job in Progress", "Sky", "Tech on-site performing the job."],
          ["needs_reschedule", "Needs Reschedule", "Rose", "Appointment fell through; reschedule required."],
          ["job_done", "Job Done", "Emerald", "Work complete; ready for payment."],
          ["payment_pending", "Payment Pending", "Lime", "Awaiting payment from CX."],
          ["cancellation_requested", "Cancellation Pending", "Amber", "Cancellation request submitted; Admin review."],
          ["cancelled", "Cancelled", "Grey", "Terminal cancelled state."],
          ["paid", "Paid", "Green", "Locked; cannot be modified again once set."],
          ["partial_paid", "Partial Paid", "Emerald", "Partial payment received; balance outstanding."],
          ["payment_requested", "Paid Approval Pending", "Green (pulse)", "Processor requested Paid; awaiting Admin approval."],
          ["pending_to_send", "Pending to Send", "Amber", "Approved quote request; sits in Quotes to Send for the Quotation Master."],
          ["quote_updated", "Quote Updated", "Blue", "Processor/Quotation Master finished the quote; the lead is pinned to the top for the requester."],
          ["scammed", "Scammed", "Red", "Fraudulent lead. Admin and Processor only."],
  ["quote_change", "Quote Change", "Violet", "Quotation Master edited the quote; records that a revision happened mid-quote."],
        ],
      },
      { type: "p", text: "Who can set which status (STATUS_CHANGE_ACCESS in src/lib/constants.ts):" },
      { type: "kv", label: "Admin", value: "Every status except cancellation_requested and payment_requested (those are workflow outcomes only)." },
      { type: "kv", label: "CS", value: "need_tech, urgent_job, waiting_customer_response, waiting_complete_details, quote_sent_waiting, quote_sent_need_follow_up, needs_quote, quote_change, needs_reschedule, cancelled, partial_paid, pending_to_send, post_visit_confirmation." },
      { type: "kv", label: "CS Admin", value: "Wider than CS: need_tech, urgent_job, waiting_customer_response, waiting_complete_details, quote_sent_waiting, post_visit_quote_sent_waiting, post_visit_confirmation, activate_customer, quote_sent_need_follow_up, needs_quote, tech_making_quote, quote_change, scheduled, job_in_progress, needs_reschedule, payment_pending, cancelled, pending_to_send. Unlike CS, a CS Admin cannot set partial_paid." },
      { type: "kv", label: "Processor", value: "post_visit_quote_sent_waiting, post_visit_confirmation, activate_customer, tech_making_quote, quote_change, waiting_customer_response, scheduled, urgent_job, job_in_progress, paid, payment_pending, job_done, needs_reschedule, cancelled, partial_paid, scammed, quote_updated." },
      { type: "kv", label: "OPR", value: "partial_paid only." },
      { type: "p", text: "Database enforcement of paid: the enforce_paid_status_rules trigger does two things. A lead that is already paid can never change status, for any caller including Admin. And only an Admin - or a server-side caller running as service_role - can move a lead into paid, so the Paid Approval workflow cannot be skipped with a direct API call. A Processor submitting a Paid Request is unaffected, because that only moves the lead to payment_requested; the approval is what sets paid. The per-role lists above are the UI's rule: the database enforces the paid boundary specifically, not every status transition." },
      { type: "p", text: "Priority sorting on LeadCard lists:" },
      { type: "bullet", text: "CS-tagged leads win first: ready_to_schedule → confirmation_sent → waiting_schedule_confirmation → booked." },
      { type: "bullet", text: "Then urgent_job (rank 1), need_tech (rank 2)." },
      { type: "bullet", text: "Then everything else by created_at descending." },
      { type: "bullet", text: "cancelled is pushed to the very bottom." },
    ],
  },
  {
    id: "tags",
    title: "6. CS Tags",
    blocks: [
      { type: "p", text: "CS tags are a secondary axis on top of status, used to surface a lead's scheduling state without changing the main status." },
      {
        type: "table",
        headers: ["Tag key", "Label", "Assignable by"],
        rows: [
          ["ready_to_schedule", "Ready to schedule", "Admin, CS, CS Admin, Processor"],
          ["confirmation_sent", "Customer Require New Schedule", "Admin, CS, CS Admin"],
          ["waiting_schedule_confirmation", "Waiting for CX for schedule confirmation", "Admin, CS, CS Admin, Processor"],
          ["booked", "Booked", "Admin, CS, CS Admin"],
          ["incomplete_details", "Incomplete details", "Admin, Processor, Quotation Master"],
        ],
      },
      { type: "p", text: "Tags are only meaningful on the pre-scheduling statuses (waiting_complete_details through needs_reschedule). Tag assignment is enforced by the enforce_lead_tag_role_access() trigger." },
      { type: "p", text: "Incomplete details is the exception: it applies on any status and sends an \"[Alert] Incomplete Details\" notification to the CS who created the lead and to every CS Admin. It does not change list ordering. Operators never see it, and the enforce_lead_tag_role_access trigger does not list opr or opr_admin at all, so an operator cannot assign any tag - the trigger raises 'You do not have permission to assign this lead tag'." },
      { type: "p", text: "Techs are recorded in the processor notes thread. The tech form stays open at the bottom of the thread and is the only way to write there - name, number and an optional short note, written as one line - \"Tech 1: John - (305) 555-0123 - he is available\". Numbering continues past the highest already used, and the collapsed notes row shows the total so the count is visible without opening the thread." },
      { type: "p", text: "Urgent Job leads whose area holds other urgent leads carry a red notice on the card - \"1 more urgent lead exists in this area\" - opening a list of the others. Nearness is same city or within 50 miles, measured between US ZIP centroids shipped with the app, so no geocoding call is made; a lead with no usable ZIP falls back to matching on city. Every lead in a cluster carries the notice, and it updates live as statuses change. Analytics reports the same clusters under Urgent Leads Sharing an Area." },
      { type: "p", text: "The lead detail page carries the same tools as the card: the lead tag picker (saved immediately, with the same permissions and alerts), CX and Tech Quick Chat, and the nearby urgent leads notice." },
      { type: "p", text: "CS Admins never see technician details - the Technician row and Tech Quick Chat are hidden on the card, and Processor Details and Tech Quick Chat on the detail page. canSeeTechDetails in src/lib/access.ts is the single rule." },
    ],
  },
  {
    id: "lead-card",
    title: "7. Lead Card Anatomy",
    blocks: [
      { type: "p", text: "The Lead Card is the primary list-view unit. Each card shows:" },
      { type: "bullet", text: "Job ID and status badge (pulsing green dot when status is payment_requested)." },
      { type: "bullet", text: "Customer name, phone (with Quo call/SMS shortcut), address." },
      { type: "bullet", text: "Service type and scheduled window (date + time range if set)." },
      { type: "bullet", text: "CS tag chip (if assigned) with priority sort influence." },
      { type: "bullet", text: "Note indicators: three dots (General / CS / Processor) that light up when notes exist for that thread." },
      { type: "bullet", text: "Amount and financial breakdown when the role is allowed to see it." },
      { type: "bullet", text: "Quick actions: change status, add note, share (Admin), copy, delete (Admin), reminder button." },
      { type: "bullet", text: "Auto-blinking indicators for Urgent Job and Need Tech." },
    ],
  },
  {
    id: "detail-panel",
    title: "8. Lead Detail Panel",
    blocks: [
      { type: "p", text: "Opening a card slides in a 60%-width right panel; the underlying list stays visible on the left and remains scrollable." },
      { type: "bullet", text: "Header: customer name, phone, address, status badge, action row." },
      { type: "bullet", text: "Address is a single free-form string (never split into city/state/zip in the form)." },
      { type: "bullet", text: "Collapsible sections: Customer Info, Service Details, Schedule, Financials, Tech Assignment, Notes, Updates, Photos, Cancellation, Payment Approval." },
      { type: "bullet", text: "Photos are stored in the private lead-photos bucket; every render fetches a fresh 1-hour signed URL." },
      { type: "bullet", text: "Every save syncs both updated_at and last_edited_at simultaneously." },
    ],
  },
  {
    id: "notes",
    title: "9. Notes Engine",
    blocks: [
      { type: "p", text: "Notes are threaded by type. Visibility is enforced at query time and in RLS." },
      {
        type: "table",
        headers: ["Thread", "Who writes", "Who sees"],
        rows: [
          ["General", "Any role with lead access", "Anyone with lead access"],
          ["CS notes", "CS, Admin", "CS, Admin"],
          ["Processor notes", "Processor, Admin", "Processor, Admin"],
        ],
      },
      { type: "p", text: "Dot indicators on the LeadCard reflect whether each thread has any note authored." },
    ],
  },
  {
    id: "creation",
    title: "10. Lead Creation & Editing",
    blocks: [
      { type: "p", text: "Admin and CS Admin can always create leads. A CS user can only create leads from the CRM while holding the Manual Lead Addition grant; otherwise they add leads through the Chrome extension. The Add Lead dialog is a single scrollable form with collapsible sections. Required fields at creation:" },
      { type: "bullet", text: "Customer name" },
      { type: "bullet", text: "Customer phone (validated real-time against duplicates; block on match)" },
      { type: "bullet", text: "Address (single string)" },
      { type: "bullet", text: "Service type" },
      { type: "bullet", text: "Direction (incoming/outgoing) and Terms (free_estimate / quoted)" },
      { type: "p", text: "Drafts are auto-saved to lead_drafts so a session refresh does not lose work." },
    ],
  },
  {
    id: "sharing",
    title: "11. Lead Sharing & Visibility",
    blocks: [
      { type: "p", text: "CS users only see leads they created OR that were explicitly shared with them. Sharing rules:" },
      { type: "bullet", text: "Admin can share any lead with any CS user via the Share dialog on the card/panel." },
      { type: "bullet", text: "Shared users receive a notification." },
      { type: "bullet", text: "Sharing is stored in lead_shares (shared_with_user_id, shared_by)." },
      { type: "bullet", text: "Processor and Admin see all leads by default (subject to status visibility overrides in lead_status_visibility)." },
      { type: "bullet", text: "OPR sees only urgent_job and partial_paid globally." },
    ],
  },
  {
    id: "copy",
    title: "12. Copy Functionality",
    blocks: [
      { type: "p", text: "Two copy variants exist depending on the lead's Terms field:" },
      { type: "kv", label: "Free Estimate", value: "Service Details, Address, Schedule Requirement. No quote line." },
      { type: "kv", label: "Quoted", value: "Service Details, Address, Schedule Requirement, Quote." },
      { type: "p", text: "Copy targets both text/plain and text/html clipboards for compatibility with WhatsApp, iMessage, and email clients. Photos can be individually copied as PNG blobs." },
    ],
  },
  {
    id: "notifications",
    title: "13. Notifications",
    blocks: [
      { type: "p", text: "The bell icon shows unread notifications. Triggers:" },
      { type: "bullet", text: "Urgent Job status change → notifies Admin + CS." },
      { type: "bullet", text: "Need Tech status change → notifies Processor + Admin." },
      { type: "bullet", text: "Lead shared with a CS user → notifies that user." },
      { type: "bullet", text: "Cancellation request created → notifies Admin." },
      { type: "bullet", text: "Paid approval request created → notifies Admin." },
      { type: "bullet", text: "Cancellation / paid approval reviewed → notifies requester." },
      { type: "p", text: "Urgent Job also triggers the full-screen UrgentLeadPopup on the requester's clients." },
    ],
  },
  {
    id: "cancellation",
    title: "14. Cancellation Request Workflow",
    blocks: [
      { type: "bullet", text: "CS or Processor opens a lead and submits a Cancellation Request (comment + optional proof image)." },
      { type: "bullet", text: "Lead status flips to cancellation_requested; the previous status is stored on the request row." },
      { type: "bullet", text: "Admin reviews from the Cancellation Requests page (blinking green dot in the sidebar when pending exists)." },
      { type: "bullet", text: "Approve → lead status becomes cancelled. Reject → lead reverts to previous status." },
      { type: "bullet", text: "Requester receives a notification with the review note." },
    ],
  },
  {
    id: "paid-approval",
    title: "15. Paid Approval Workflow",
    blocks: [
      { type: "p", text: "Mirrors the cancellation flow for a Processor-initiated Paid request." },
      { type: "bullet", text: "Processor cannot mark a lead Paid directly. They submit a Paid Request (amount + screenshot + comment)." },
      { type: "bullet", text: "Lead status flips to payment_requested (pulsing green dot on the card)." },
      { type: "bullet", text: "The Paid Requests page is Admin-only, with a blinking green dot in the sidebar when pending exists." },
      { type: "bullet", text: "Approve → lead becomes paid with the provided amount + screenshot copied over. Paid is then locked forever." },
      { type: "bullet", text: "Reject → lead reverts to the previous status; Processor sees the note." },
      { type: "bullet", text: "Admin can still set Paid directly without any approval." },
    ],
  },
  {
    id: "scheduling",
    title: "16. Scheduling & Areas",
    blocks: [
      { type: "p", text: "The Schedule page shows the day's booked leads with tech, time window, and address." },
      { type: "p", text: "The Areas page renders a Leaflet map (plain L.map, no react-leaflet) using cached geocoding in localStorage. Marker color reflects lead status; the sidebar breakdown groups by status and area with a cross-tab and ranking list." },
    ],
  },
  {
    id: "activity",
    title: "17. Activity Logs & Audit",
    blocks: [
      { type: "p", text: "activity_logs captures every meaningful action: create, update, status change, note add, share, cancellation request, payment approval, delete. Each row stores user_id, user_name, action, target_type/id, details, timestamp. Deleting a user unassigns their leads and NULLs their user_id on logs and notes to keep history intact." },
    ],
  },
  {
    id: "quo-ai",
    title: "18. Quo Monitor (OpenPhone integration)",
    blocks: [
      { type: "p", text: "Quo mirrors OpenPhone conversations into the CRM for triage. Access is Admin by default, and Admin can grant it per user with an allowed=true row in navigation_permissions (see the tab permissions table). The rest of this section describes the Admin-facing triage workflow." },
      { type: "bullet", text: "Ingestion: quo-webhook receives real-time message events immediately; the Quo Monitor subscribes to Supabase Realtime on quo_conversations, quo_messages, pins, and number preferences so new chats appear without refreshing the whole screen." },
      { type: "bullet", text: "Reliability backfill: quo-reconcile-sync is only a safety net for missed webhooks. It reconciles recent Quo data on a schedule but the normal user experience is live webhook + realtime updates, not waiting for the cron window." },
      { type: "bullet", text: "Complete chat history: the Quo monitor paginates through conversation rows, selected conversation messages, and message-search matches instead of relying on Supabase's default first page or capping the visible transcript at 100 messages; the lead-side Quo drawer fetches up to 20 Quo API pages for a fuller thread." },
      { type: "bullet", text: "Admin Quo drawer: lead phone numbers open a live side drawer. The chat is read straight from the webhook data stored in quo_conversations/quo_messages (no Quo API calls). Messages typed in the drawer are queued in quo_outbound_messages and sent by the CRM browser extension; Realtime keeps every open screen in sync." },
      { type: "bullet", text: "Contacts sync: quo-sync-contacts pulls the OpenPhone contact list." },
      { type: "bullet", text: "Quo settings (webhook pause, number labels/emojis, cron secret) are stored in quo_ai_settings." },
      { type: "bullet", text: "Pinned conversations cap at 50 (enforced by trigger)." },
    ],
  },
  {
    id: "security",
    title: "19. Security & Authentication",
    blocks: [
      { type: "bullet", text: "Supabase Auth email/password. New signups create a profile row via handle_new_user()." },
      { type: "bullet", text: "MFA available; the MFAEnroll component walks a user through TOTP setup." },
      { type: "bullet", text: "Non-admin users must pass a 6-digit access code check on sensitive actions; the check is fail-closed and signs the user out on any verification error." },
      { type: "bullet", text: "RLS on every table. Roles live in user_roles; policies always call has_role() to avoid recursion." },
      { type: "bullet", text: "Edge functions use SB_SERVICE_ROLE_KEY (never expose service role to the browser)." },
      { type: "bullet", text: "lead-photos bucket is private; access is via short-lived signed URLs (1 hour)." },
    ],
  },
  {
    id: "data",
    title: "20. Data Management",
    blocks: [
      { type: "bullet", text: "Draft auto-save: lead_drafts persists in-progress forms." },
      { type: "bullet", text: "Admin global export: xlsx export across all leads." },
      { type: "bullet", text: "Timestamps: updated_at and last_edited_at are always synced together on lead updates." },
      { type: "bullet", text: "Deleted users: leads unassigned, notes/logs NULLed, permission rows removed." },
    ],
  },
  {
    id: "quotation",
    title: "21. Quote Request Workflow (Quotation Master)",
    blocks: [
      { type: "p", text: "Quote work passes through approval before it reaches users flagged as Quotation Master." },
      { type: "bullet", text: "When CS selects \"Pending to Send\", the lead stays at its current status and a request appears in Quote Approval." },
      { type: "bullet", text: "CS can monitor their requests. CS Admin or Admin can approve or decline; access to the tab remains configurable per user in Settings." },
      { type: "bullet", text: "Approval moves the lead to Pending to Send and records the original CS requester. Decline closes the request and leaves the lead at its previous status." },
      { type: "bullet", text: "The \"Quote Pending to Send\" page lists those leads. Access: Admin plus any user with the Quotation Master flag enabled in Settings > Users." },
      { type: "bullet", text: "The sidebar shows an amber alert dot and plays an alert sound while requests are pending." },
      { type: "bullet", text: "When the quote is ready, the status moves to \"Quote Updated\"; the lead is pinned to the top of the requester's list with a blinking highlight until it is opened." },
      { type: "bullet", text: "show_quote_to_opr controls whether the quote text is visible to OPR users." },
    ],
  },
  {
    id: "technicians",
    title: "22. Technicians & Map View",
    blocks: [
      { type: "p", text: "Technicians and the map live under one \"Technicians\" navigation entry. The map is off by default and toggled on demand for performance." },
      { type: "bullet", text: "Manual add/edit of technicians, plus CSV/TSV import with duplicate detection by phone number only." },
      { type: "bullet", text: "Multi-select with bulk delete and copy-as-TSV; export is Admin-only." },
      { type: "bullet", text: "Server-side search through the search_technicians RPC." },
      { type: "bullet", text: "Map shows Urgent Leads and Technicians and matches techs to leads within a 50-mile radius; markers are diffed on update so the map never freezes." },
      { type: "bullet", text: "Geocoding uses Nominatim with throttling and a fallback, cached in localStorage; rate limits are retried instead of dropping pins." },
    ],
  },
  {
    id: "nearby-areas",
    title: "23. Top 5 Nearby Populated Areas",
    blocks: [
      { type: "p", text: "The lead form shows the five largest nearby population centres for the entered address, to help judge coverage." },
      { type: "bullet", text: "us_places holds 31,839 US places (2024 Census Gazetteer geometry + 2023 ACS population); refresh yearly with the \"Sync Population Data\" button in Settings > Documentation." },
      { type: "bullet", text: "A PostGIS distance RPC finds nearest places; the generate-nearby-areas edge function composes the result and it is stored as JSONB on the lead." },
      { type: "bullet", text: "Lookup failures are silent in the UI (no global error overlay) and the box simply stays empty." },
    ],
  },
  {
    id: "crm-updates",
    title: "24. CRM Updates & Quick Chat",
    blocks: [
      { type: "p", text: "CRM Updates: Admins publish release/announcement notes (crm_updates); each user's read state is tracked in crm_update_receipts and delivered live over Realtime as a popup." },
      { type: "p", text: "Quick Chat: gated by a navigation permission - quick_chat for Customer Service and CS Admin, tech_quick_chat for Technicians, OPR and OPR Admin - and by the can_use_quick_chat(uuid) RLS check on quo_outbound_messages, which accepts either key. A blinking green dot appears on a lead when the customer sent the last message." },
      { type: "p", text: "Login and new-user forms include show/hide password toggles." },
      { type: "p", text: "The former Quo AI assistant (auto-tagging, daily briefs, AI job queue and its tables) has been fully removed; Quo is now webhook chat only." },
    ],
  },
  {
    id: "tech",
    title: "25. Technical Stack",
    blocks: [
      {
        type: "table",
        headers: ["Layer", "Technology"],
        rows: [
          ["Frontend", "React 18, Vite 5, TypeScript 5, Tailwind CSS v3, shadcn/ui"],
          ["State/data", "TanStack Query, Supabase JS client, Realtime channels"],
          ["UI/UX", "Inter font, custom shadow tokens, Framer Motion (butterSpring)"],
          ["Map", "Leaflet (plain, not react-leaflet), localStorage geocoding cache"],
          ["Backend", "Supabase Postgres + RLS, Storage (lead-photos), Edge Functions (Deno)"],
          ["Geo data", "PostGIS + us_places (Census Gazetteer/ACS), Nominatim geocoding"],
          ["Telephony", "OpenPhone / Quo API (api.openphone.com/v1) via webhook + reconcile jobs"],
          ["Testing", "Vitest, Playwright"],
        ],
      },
    ],
  },
];
