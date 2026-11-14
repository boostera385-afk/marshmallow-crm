export type AppRole = 'admin' | 'processor' | 'customer_service' | 'opr' | 'cs_admin' | 'opr_admin';

export type CsTag = 'confirmation_sent' | 'waiting_schedule_confirmation' | 'booked' | 'ready_to_schedule' | 'incomplete_details';

export const CS_TAG_LABELS: Record<CsTag, string> = {
  confirmation_sent: 'Customer Require New Schedule',
  waiting_schedule_confirmation: 'Waiting for CX for schedule confirmation',
  booked: 'Booked',
  ready_to_schedule: 'Ready to schedule',
  incomplete_details: 'Incomplete details',
};

export type LeadStatus =
  | 'waiting_complete_details'
  | 'urgent_job'
  | 'quote_sent_waiting'
  | 'post_visit_quote_sent_waiting'
  | 'post_visit_confirmation'
  | 'activate_customer'
  | 'quote_sent_need_follow_up'
  | 'needs_quote'
  | 'tech_making_quote'
  | 'quote_change'
  | 'waiting_customer_response'
  | 'need_tech'
  | 'scheduled'
  | 'job_in_progress'
  | 'needs_reschedule'
  | 'job_done'
  | 'payment_pending'
  | 'cancellation_requested'
  | 'cancelled'
  | 'paid'
  | 'partial_paid'
  | 'payment_requested'
  | 'scammed'
  | 'pending_to_send'
  | 'quote_updated';

export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  waiting_complete_details: { label: 'Waiting Complete Details', color: 'status-amber' },
  urgent_job: { label: 'Urgent Job', color: 'status-red' },
  quote_sent_waiting: { label: 'Quote Sent - Waiting', color: 'status-blue' },
  post_visit_quote_sent_waiting: { label: 'Post Visit-Quote Sent-Waiting', color: 'status-blue' },
  post_visit_confirmation: { label: 'Post Visit Confirmation', color: 'status-amber' },
  activate_customer: { label: 'Activate Customer', color: 'status-green' },
  quote_sent_need_follow_up: { label: 'Quote Sent - Need Follow Up', color: 'status-amber' },
  needs_quote: { label: 'Needs Quote', color: 'status-amber' },
  tech_making_quote: { label: 'Tech Making Quote', color: 'status-indigo' },
  quote_change: { label: 'Quote Change', color: 'status-indigo' },
  waiting_customer_response: { label: 'Waiting Customer Response', color: 'status-blue' },
  need_tech: { label: 'Need Tech', color: 'status-amber' },
  scheduled: { label: 'Scheduled', color: 'status-blue' },
  job_in_progress: { label: 'Job in Progress', color: 'status-blue' },
  needs_reschedule: { label: 'Needs Reschedule', color: 'status-amber' },
  job_done: { label: 'Job Done', color: 'status-green' },
  payment_pending: { label: 'Payment Pending', color: 'status-amber' },
  cancellation_requested: { label: 'Cancellation Pending', color: 'status-amber' },
  cancelled: { label: 'Cancelled', color: 'status-muted' },
  paid: { label: 'Paid', color: 'status-green' },
  partial_paid: { label: 'Partial Paid', color: 'status-green' },
  payment_requested: { label: 'Paid Approval Pending', color: 'status-green' },
  scammed: { label: 'Scammed', color: 'status-red' },
  pending_to_send: { label: 'Pending to Send', color: 'status-amber' },
  quote_updated: { label: 'Quote Updated', color: 'status-blue' },
};

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  is_quotation_master?: boolean;
  can_manage_users?: boolean;
  opr_code?: string | null;
  can_view_tech_report?: boolean | null;
  /** CS-only grant that unlocks the manual "New Lead" button in the CRM. */
  can_add_manual_leads?: boolean | null;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

export interface Lead {
  id: string;
  job_id: string;
  status: LeadStatus;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  /** Optional second number. A lead needs a cell phone, a landline, or both. */
  customer_landline?: string | null;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  /** Census-geocoded point used for map placement and technician coverage. */
  latitude?: number | null;
  longitude?: number | null;
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  expected_completion_date?: string | null;
  amount: number | null;
  created_by: string | null;
  quote_requested_by?: string | null;
  assigned_cs: string | null;
  last_edited_by: string | null;
  created_by_name?: string | null;
  last_edited_by_name?: string | null;
  last_edited_at: string | null;
  created_at: string;
  updated_at: string;
  /** When the lead was last flipped to urgent_job (drives Urgent Job ordering). */
  urgent_at?: string | null;
  // Payment fields
  payment_amount: number | null;
  payment_screenshot_url: string | null;
  // CS fields
  number_name: string | null;
  quote: string | null;
  service_details: string | null;
  customer_schedule_requirements: string | null;
  reference_name: string | null;
  // Processor fields
  tech_name: string | null;
  tech_number: string | null;
  terms: 'free_estimate' | 'quoted' | null;
  direction: 'incoming' | 'outgoing' | null;
  cs_tag?: CsTag | null;
  /** 'ai' when the current tag was set by the schedule confirmation AI. */
  cs_tag_source?: 'ai' | null;
  booked_at?: string | null;
  half_address?: string | null;
  /** Server-computed "City, ST ZIP" (selected for Operators only; never street text). */
  location_label?: string | null;
  labor_amount: number | null;
  material_amount: number | null;
  for_you_amount: number | null;
  for_us_amount: number | null;
  cancellation_reason?: string | null;
  source_url?: string | null;
  /** Active technicians near the job address. Derived in the database, never set by a user. */
  coverage_tech_count?: number | null;
  /** good = 10+, normal = 1-9, bad = 0, null when the address cannot be resolved. */
  coverage_level?: 'good' | 'normal' | 'bad' | null;
  coverage_area_label?: string | null;
  coverage_checked_at?: string | null;
  // Joined fields
  creator_name?: string;
  editor_name?: string;
  show_quote_to_opr?: boolean | null;
  /** Plain Operators only: half the labor, from get_operator_safe_leads(); their labor_amount is null. */
  operator_labor_amount?: number | null;
}


export type CancellationRequestStatus = 'pending' | 'approved' | 'rejected';

export interface LeadCancellationRequest {
  id: string;
  lead_id: string;
  previous_status: LeadStatus;
  requested_by: string | null;
  requested_by_name?: string | null;
  requested_by_role: AppRole;
  comment: string;
  proof: string | null;
  proof_image_path?: string | null;
  status: CancellationRequestStatus;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  requester_name?: string | null;
  reviewer_name?: string | null;
  ai_reason_code?: string | null;
  ai_suggested_reason?: string | null;
  ai_suggested_at?: string | null;
  ai_reason_applied?: boolean | null;
}

export interface LeadUpdate {
  id: string;
  lead_id: string;
  author_id: string | null;
  author_name: string;
  author_role: AppRole;
  content: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_name: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string | null;
  created_at: string;
}

export interface NavigationPermission {
  id: string;
  user_id: string;
  nav_section: string;
  allowed: boolean;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  lead_id: string | null;
  read: boolean;
  created_at: string;
}

export interface StatusPermission {
  id: string;
  user_id: string;
  status: LeadStatus;
  allowed: boolean;
}

export interface LeadOperatorAssignment {
  id: string;
  lead_id: string;
  operator_user_id: string;
  assigned_by: string;
  assigned_by_name: string;
  created_at: string;
}

export interface UserNotepad {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

