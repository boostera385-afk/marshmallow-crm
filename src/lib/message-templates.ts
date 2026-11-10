import type { Lead } from "@/types";
import { formatLeadSchedule } from "@/lib/lead-copy";

export type MessageTemplateKey = "technician_message" | "technician_reminder";

export const DEFAULT_MESSAGE_TEMPLATES: Record<MessageTemplateKey, string> = {
  technician_message: `*Customer #{customer_number}*

Customer Name: {customer_name}
Customer Number: {customer_phone}
Customer Address: {customer_address}
Service Details: {service_details}

Job Scheduled for: {schedule}
{reference_line}`,
  technician_reminder: `Hi {tech_name}, This is the Automated Reminder, You have to visit the following customer today between {schedule_time}, Please Text back by "Yes" so we can update our system that you will head over

Customer Name: {customer_name}
Customer Number: {customer_phone}
Customer Address: {customer_address}`,
};

export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateKey, string> = {
  technician_message: "Copy Technician Message",
  technician_reminder: "Reminder Message",
};

const normalize = (value: unknown) => String(value ?? "").trim();

/** Schedule as the technician messages wrote it before June 2026, e.g. "Today MONDAY 9th November between 9:00am-11:00am". */
export const formatTechnicianSchedule = (
  lead: Pick<Lead, "scheduled_date" | "scheduled_time_start" | "scheduled_time_end">,
  now: Date = new Date(),
) => {
  if (!lead.scheduled_date) return "TBD";
  const date = new Date(`${lead.scheduled_date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return lead.scheduled_date;
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const day = date.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  const time = (value: string | null) => {
    if (!value) return "";
    const [h, m] = value.split(":").map(Number);
    if (Number.isNaN(h)) return value;
    const hour = h % 12 || 12;
    const ampm = h >= 12 ? "pm" : "am";
    return `${hour}:${String(m || 0).padStart(2, "0")}${ampm}`;
  };
  const start = time(lead.scheduled_time_start);
  const end = time(lead.scheduled_time_end);
  const range = start && end ? ` between ${start}-${end}` : "";
  const today = date.toDateString() === now.toDateString() ? "Today " : "";
  return `${today}${days[date.getDay()]} ${day}${suffix} ${months[date.getMonth()]}${range}`;
};

/**
 * The Quoted and Free Estimate technician messages, restored word for word from
 * before the June 2026 template change removed them. Leads with no terms use the
 * editable technician_message template.
 */
export const TECHNICIAN_MESSAGE_BY_TERMS = {
  quoted: `*Customer #{customer_number_spaced}*

Customer Name: {customer_name}
Customer Number: {customer_phone}
Customer Address: {customer_address}
Service: {service_details}

Customer is agreed to pay ($\{labor_amount_or_zero}) total labor
($\{material_amount_or_zero}) FOR MATERIALS

For you: $\{for_you_amount_or_zero} labor including material
For us: $\{for_us_amount_or_zero} from total labor

Job Scheduled for: {technician_schedule}
{reference_block}`,
  free_estimate: `*Customer #{customer_number_spaced}*

Customer Name: {customer_name}
Customer Number: {customer_phone}
Customer Address: {customer_address}
Service Details: {service_details}

FREE ESTIMATE VISIT

FREE ESTIMATE VISIT Scheduled for: {technician_schedule}
{reference_block}`,
} as const;

/**
 * Picks the technician message for a lead: the same for every role, as before
 * June 2026. The messages are built in: the message_templates table they were
 * once meant to be edited in was never created in production (every read was a
 * 404), so nothing is read from the database.
 */
export const technicianMessageTemplate = (lead: Pick<Lead, "terms">) => {
  if (lead.terms === "free_estimate") return TECHNICIAN_MESSAGE_BY_TERMS.free_estimate;
  if (lead.terms === "quoted") return TECHNICIAN_MESSAGE_BY_TERMS.quoted;
  return DEFAULT_MESSAGE_TEMPLATES.technician_message;
};

export const renderLeadTemplate = (
  template: string,
  lead: Lead,
  extras: Record<string, string> = {},
) => {
  const schedule = formatLeadSchedule(lead);
  const scheduleTime = [lead.scheduled_time_start, lead.scheduled_time_end].filter(Boolean).join("-");
  const values: Record<string, string> = {
    customer_number: normalize(extras.customer_number),
    reference_name: normalize(extras.reference_name || lead.reference_name),
    reference_line: normalize(extras.reference_name || lead.reference_name)
      ? `-\n(Give the reference of "${normalize(extras.reference_name || lead.reference_name)}" if customer ask)`
      : "",
    customer_name: normalize(lead.customer_name),
    customer_phone:
      normalize(lead.customer_phone) ||
      (normalize(lead.customer_landline) ? `${normalize(lead.customer_landline)} (Landline)` : ""),
    customer_address: normalize(lead.address),
    address: normalize(lead.address),
    service_details: normalize(lead.service_details || lead.service_type),
    service_type: normalize(lead.service_type),
    quote: normalize(lead.quote),
    schedule,
    schedule_time: scheduleTime || schedule,
    tech_name: normalize(lead.tech_name) || "TECH NAME",
    tech_number: normalize(lead.tech_number),
    labor_amount: normalize(lead.labor_amount),
    material_amount: normalize(lead.material_amount),
    for_you_amount: normalize(lead.for_you_amount),
    for_us_amount: normalize(lead.for_us_amount),
    customer_number_spaced: normalize(extras.customer_number) ? ` ${normalize(extras.customer_number)}` : "",
    reference_block: normalize(extras.reference_name || lead.reference_name)
      ? `\n-\n(Give the reference of "${normalize(extras.reference_name || lead.reference_name)}" if customer ask)`
      : "",
    technician_schedule: formatTechnicianSchedule(lead),
    labor_amount_or_zero: String(lead.labor_amount ?? 0),
    material_amount_or_zero: String(lead.material_amount ?? 0),
    for_you_amount_or_zero: String(lead.for_you_amount ?? 0),
    for_us_amount_or_zero: String(lead.for_us_amount ?? 0),
  };

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
};
