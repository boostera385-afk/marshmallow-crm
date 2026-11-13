import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/constants";

/**
 * A plain Operator's (`opr`, not `opr_admin`) session cannot read `leads`
 * directly anymore — migration 20261216000000_operator_safe_leads_api.sql adds
 * a RESTRICTIVE policy denying it, because RLS can only withhold whole rows,
 * not the customer-name/quote/CS-notes columns a plain Operator must never see
 * (src/lib/operator-privacy.ts). This calls the server-side projection that
 * already nulls those columns at the source instead.
 *
 * Realtime `postgres_changes` on `leads` is RLS-gated the same way, so a plain
 * Operator's browser no longer receives any `leads` event either. Callers of
 * this function are expected to re-poll it on an interval instead of relying
 * on `subscribeToLeadChanges` (src/lib/realtime.ts) for this role.
 */
export async function fetchOperatorSafeLeads(): Promise<Lead[]> {
  const { data, error } = await supabase.rpc("get_operator_safe_leads");
  if (error) throw error;
  return ((data ?? []) as unknown) as Lead[];
}
