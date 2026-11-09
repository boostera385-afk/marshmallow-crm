import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getDefaultVisibleStatuses, isOperatorRole } from "@/lib/access";
import { isScheduleTag } from "@/lib/lead-tags";
import { fetchMyPaidLeadIds, fetchPaidLeadAccess, isInPaidGrant } from "@/lib/paid-lead-access";
import type { LeadStatus } from "@/types";

type VisibilityRow = {
  role?: string | null;
  user_id?: string | null;
  status: string;
  is_visible: boolean;
};

export function useAllowedStatuses() {
  const { role, user } = useAuth();

  const { data: allowedStatuses } = useQuery({
    queryKey: ["lead-status-visibility", user?.id, role],
    queryFn: async () => {
      const baseAllowed = getDefaultVisibleStatuses(role);

      if (!role) return baseAllowed;
      if (role === "admin") return baseAllowed;
      if (!user?.id) return baseAllowed;

      // OPR Admin inherits every role-wide status granted to OPR. User-specific
      // overrides still apply last, so an admin can fine-tune an individual.
      const visibilityRole = role === "opr_admin" ? "opr" : role;
      const { data, error } = await supabase
        .from("lead_status_visibility")
        .select("user_id,role,status,is_visible")
        .or(`user_id.eq.${user.id},and(user_id.is.null,role.eq.${visibilityRole})`);

      if (error || !Array.isArray(data)) {
        return baseAllowed;
      }

      const finalAllowed = new Set<string>(baseAllowed);
      const rows = data as VisibilityRow[];
      const roleRows = rows.filter((row) => !row.user_id && row.role === visibilityRole);
      const userSpecificRows = rows.filter((row) => row.user_id === user.id);

      for (const row of [...roleRows, ...userSpecificRows]) {
        if (!row?.status) {
          continue;
        }

        if (row.is_visible === false) {
          finalAllowed.delete(row.status);
        }

        if (row.is_visible === true) {
          finalAllowed.add(row.status);
        }
      }

      return finalAllowed;
    },
    enabled: !!role && !!user?.id,
    staleTime: 30_000,
  });

  // The user's paid-lead grant (Settings -> Status visibility -> Paid). A date range
  // limits which paid leads show, by the date each lead became paid, matching the
  // database for every role (the database reports which paid leads are in range).
  const { data: paidGrant = null } = useQuery({
    queryKey: ["paid-lead-access", user?.id],
    enabled: !!user?.id && !!role && role !== "admin",
    queryFn: async () => (await fetchPaidLeadAccess()).find((grant) => grant.user_id === user?.id) ?? null,
    staleTime: 30_000,
  });
  const hasPaidRange = Boolean(paidGrant?.start_date && paidGrant?.end_date);
  const { data: paidIdsInRange } = useQuery({
    queryKey: ["paid-lead-ids", user?.id, paidGrant?.start_date ?? null, paidGrant?.end_date ?? null],
    enabled: !!user?.id && hasPaidRange,
    queryFn: fetchMyPaidLeadIds,
    staleTime: 30_000,
  });
  const paidIdSet = useMemo(() => (paidIdsInRange ? new Set(paidIdsInRange) : null), [paidIdsInRange]);

  const statuses = allowedStatuses ?? getDefaultVisibleStatuses(role);

  const filterLeads = <T extends { id: string; status: string; cs_tag?: string | null }>(leads: T[]): T[] => {
    return leads.filter((lead) => {
      if (lead.status === "paid" && paidGrant && !isInPaidGrant(lead.id, paidGrant, paidIdSet)) return false;
      // Operators see tagged leads, but only for the scheduling tags their workflow covers.
      return statuses.has(lead.status) || (isOperatorRole(role) && isScheduleTag(lead.cs_tag));
    });
  };

  return {
    allowedStatuses: statuses,
    filterLeads,
  };
}
