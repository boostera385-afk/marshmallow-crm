import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useIsLastMessageFromCustomer(phone: string | null | undefined, enabled: boolean = true) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : "";
  const queryEnabled = Boolean(last10) && enabled;

  const query = useQuery({
    queryKey: ["quo-last-message", last10],
    enabled: queryEnabled,
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
      
      return bestCustomer > bestAgent;
    },
  });

  return { isFromCustomer: query.data ?? false };
}
