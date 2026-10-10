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

const normalize = (value: unknown) => String(value ?? "").trim();

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
  };

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
};

export function useMessageTemplate(key: MessageTemplateKey) {
  return useQuery({
    queryKey: ["message-template", key],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from(table: "message_templates"): {
          select(columns: "template"): {
            eq(column: "key", value: MessageTemplateKey): {
              maybeSingle(): PromiseLike<{ data: { template: string } | null; error: unknown }>;
            };
          };
        };
      })
        .from("message_templates")
        .select("template")
        .eq("key", key)
        .maybeSingle();

      if (error) return DEFAULT_MESSAGE_TEMPLATES[key];
      return (data as { template?: string } | null)?.template || DEFAULT_MESSAGE_TEMPLATES[key];
    },
    staleTime: 20_000,
  });
}
