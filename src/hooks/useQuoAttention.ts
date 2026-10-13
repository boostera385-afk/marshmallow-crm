import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LeadStatus } from "@/lib/constants";

const ATTENTION_STATUSES: ReadonlySet<LeadStatus> = new Set([
  "cancelled",
  "cancellation_requested",
  "paid",
  "job_done",
  "partial_paid",
]);

/**
 * Detects when a resolved/cancelled lead's customer has messaged again on Quo
 * after the lead was last updated. Used to surface a blinking "Needs attention"
 * badge on the lead card so ops can reopen or follow up.
 */
export function useQuoAttention(params: {
  leadId: string;
  phone: string | null | undefined;
  status: LeadStatus;
  updatedAt: string | null | undefined;
}) {
  const { leadId, phone, status, updatedAt } = params;
  const digits = (phone ?? "").replace(/\D/g, "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : "";
  const enabled = Boolean(last10) && ATTENTION_STATUSES.has(status);

  const query = useQuery({
    queryKey: ["quo-attention", leadId, last10],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_conversations")
        .select("last_customer_message_at, last_agent_message_at, customer_number")
        .ilike("customer_number", `%${last10}`)
        .limit(5);
      if (error) throw error;
      const rows =
        (data as Array<{
          last_customer_message_at: string | null;
          last_agent_message_at: string | null;
          customer_number: string | null;
        }>) ?? [];
      let bestCustomer = 0;
      let bestAgent = 0;
      for (const r of rows) {
        const rDigits = (r.customer_number ?? "").replace(/\D/g, "");
        if (rDigits.slice(-10) !== last10) continue;
        const c = r.last_customer_message_at ? new Date(r.last_customer_message_at).getTime() : 0;
        const a = r.last_agent_message_at ? new Date(r.last_agent_message_at).getTime() : 0;
        if (c > bestCustomer) bestCustomer = c;
        if (a > bestAgent) bestAgent = a;
      }
      return { customerTime: bestCustomer, agentTime: bestAgent };
    },
  });

  if (!enabled || !query.data) return { needsAttention: false };
  const leadTime = updatedAt ? new Date(updatedAt).getTime() : 0;
  const { customerTime, agentTime } = query.data;
  const needsAttention = customerTime > agentTime && customerTime > leadTime;
  return { needsAttention };
}
