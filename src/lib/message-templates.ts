import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

/** Built-in "Check Template": asks a technician whether they can take a new job. */
export const DEFAULT_CHECK_TEMPLATE = `Hi {tech_name}, How are you? I have a new customer looking for {service}, kindly check and confirm if you can visit {schedule_requirement}?

Service Details: {service_details}

Area: {area}

Schedule Requirement: {schedule_requirement}

QUOTE : {quote}`;

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

/** Templates an admin can edit in Settings > Templates. Each falls back to its built-in text. */
export type EditableTemplateKey =
  | "technician_message"
  | "technician_message_quoted"
  | "technician_message_free_estimate"
  | "check_template";

export const EDITABLE_TEMPLATE_KEYS: EditableTemplateKey[] = [
  "technician_message",
  "technician_message_quoted",
  "technician_message_free_estimate",
  "check_template",
];

export const BUILT_IN_TEMPLATES: Record<EditableTemplateKey, string> = {
  technician_message: DEFAULT_MESSAGE_TEMPLATES.technician_message,
  technician_message_quoted: TECHNICIAN_MESSAGE_BY_TERMS.quoted,
  technician_message_free_estimate: TECHNICIAN_MESSAGE_BY_TERMS.free_estimate,
  check_template: DEFAULT_CHECK_TEMPLATE,
};

export const EDITABLE_TEMPLATE_INFO: Record<EditableTemplateKey, { label: string; description: string }> = {
  technician_message: {
    label: "Technician Message",
    description: "Copy Technician Message for leads with no terms selected.",
  },
  technician_message_quoted: {
    label: "Technician Message: Quoted",
    description: "Copy Technician Message for leads with Quoted terms.",
  },
  technician_message_free_estimate: {
    label: "Technician Message: Free Estimate",
    description: "Copy Technician Message for leads with Free Estimate Visit terms.",
  },
  check_template: {
    label: "Check Template",
    description: "Asks a technician whether they can take a new customer before the job is assigned.",
  },
};

export const TEMPLATE_PLACEHOLDERS: Record<EditableTemplateKey, string[]> = {
  technician_message: ["customer_number", "customer_name", "customer_phone", "customer_address", "service_details", "schedule", "technician_schedule", "reference_line", "reference_block", "quote", "tech_name"],
  technician_message_quoted: ["customer_number_spaced", "customer_name", "customer_phone", "customer_address", "service_details", "labor_amount_or_zero", "material_amount_or_zero", "for_you_amount_or_zero", "for_us_amount_or_zero", "technician_schedule", "reference_block", "quote", "tech_name"],
  technician_message_free_estimate: ["customer_number_spaced", "customer_name", "customer_phone", "customer_address", "service_details", "technician_schedule", "reference_block", "quote", "tech_name"],
  check_template: ["tech_name", "service", "service_details", "area", "city", "state", "schedule_requirement", "quote"],
};

/** Admin-saved template texts by key; keys with no saved row are absent. */
export type SavedTemplates = Partial<Record<EditableTemplateKey, string>>;

/** The saved text for a key, or its built-in text when none is saved (or it is blank). */
export const resolveTemplate = (key: EditableTemplateKey, saved?: SavedTemplates) => {
  const value = saved?.[key];
  return value && value.trim() ? value : BUILT_IN_TEMPLATES[key];
};

/** Picks the technician message for a lead by its terms; the same for every role. */
export const technicianMessageTemplate = (lead: Pick<Lead, "terms">, saved?: SavedTemplates) => {
  if (lead.terms === "free_estimate") return resolveTemplate("technician_message_free_estimate", saved);
  if (lead.terms === "quoted") return resolveTemplate("technician_message_quoted", saved);
  return resolveTemplate("technician_message", saved);
};

export const MESSAGE_TEMPLATES_QUERY_KEY = ["message-templates"] as const;

export async function fetchSavedTemplates(): Promise<SavedTemplates> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("key, template")
    .in("key", EDITABLE_TEMPLATE_KEYS);
  if (error) throw new Error(error.message);
  const saved: SavedTemplates = {};
  for (const row of data ?? []) {
    if ((EDITABLE_TEMPLATE_KEYS as string[]).includes(row.key)) saved[row.key as EditableTemplateKey] = row.template;
  }
  return saved;
}

/**
 * Admin-saved templates, read once per minute at most and only while a copy
 * dialog or the Templates tab is open. A failed read (for example before the
 * migration is applied) is reported through `isError`; callers then use the
 * built-in texts.
 */
export function useSavedTemplates(enabled: boolean) {
  return useQuery({
    queryKey: MESSAGE_TEMPLATES_QUERY_KEY,
    queryFn: fetchSavedTemplates,
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Fills a template from the lead's saved values; unknown placeholders become empty. */
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
    tech_name: normalize(extras.tech_name) || normalize(lead.tech_name) || "TECH NAME",
    service: normalize(lead.service_type) || normalize(lead.service_details),
    city: normalize(lead.city),
    state: normalize(lead.state),
    area: [normalize(lead.city), normalize(lead.state)].filter(Boolean).join(" "),
    schedule_requirement:
      normalize(lead.customer_schedule_requirements) || (lead.scheduled_date ? formatTechnicianSchedule(lead) : ""),
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
