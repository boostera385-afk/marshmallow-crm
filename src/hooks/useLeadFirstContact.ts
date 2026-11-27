import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToTableChanges } from "@/lib/realtime";
import { logActivity } from "@/lib/activity";
import {
  CONTACT_LABELS,
  parseFirstContact,
  type ContactEvent,
  type ContactType,
  type FirstContact,
} from "@/lib/contact-direction";

// lead_first_contacts / lead_contact_events / set_lead_first_contact: migration 20261127061235.
const FIRST_CONTACT_COLUMNS = "lead_id, contact, source, occurred_at, set_by, updated_at";

export const firstContactKey = (leadId: string) => ["lead-first-contact", leadId] as const;
export const contactEventsKey = (leadId: string) => ["lead-contact-events", leadId] as const;

/**
 * Loads the first contact for a page of leads in one request and seeds each lead's cache entry
 * (null when there is none), so the cards below read from cache instead of one request each.
 * Also keeps those entries live from realtime changes.
 */
export function usePrefetchFirstContacts(leadIds: string[]) {
  const queryClient = useQueryClient();
  const idsKey = useMemo(() => [...new Set(leadIds)].sort().join(","), [leadIds]);

  const query = useQuery({
    queryKey: ["lead-first-contacts-batch", idsKey],
    enabled: idsKey.length > 0,
    queryFn: async () => {
      const ids = idsKey.split(",");
      const { data, error } = await supabase
        .from("lead_first_contacts")
        .select(FIRST_CONTACT_COLUMNS)
        .in("lead_id", ids);
      if (error) throw error;
      const byLead = new Map<string, FirstContact>();
      for (const row of (data ?? []) as unknown[]) {
        const parsed = parseFirstContact(row);
        if (parsed) byLead.set(parsed.lead_id, parsed);
      }
      for (const id of ids) queryClient.setQueryData(firstContactKey(id), byLead.get(id) ?? null);
      return true;
    },
  });

  useEffect(() => {
    if (!idsKey) return;
    return subscribeToTableChanges<RealtimePostgresChangesPayload<Record<string, unknown>>>(
      "lead_first_contacts",
      (payload) => {
        if (payload.eventType === "DELETE") {
          const leadId = (payload.old as { lead_id?: unknown })?.lead_id;
          if (typeof leadId === "string") queryClient.setQueryData(firstContactKey(leadId), null);
          return;
        }
        const parsed = parseFirstContact(payload.new);
        if (parsed) queryClient.setQueryData(firstContactKey(parsed.lead_id), parsed);
        // A new event changes the history counts shown in the menu.
        if (parsed) void queryClient.invalidateQueries({ queryKey: contactEventsKey(parsed.lead_id) });
      },
    );
  }, [idsKey, queryClient]);

  return { ready: query.isSuccess || query.isError, isError: query.isError };
}

/**
 * One lead's first contact. When the list already prefetched it, pass `prefetched` so the card
 * reads the cache only; on other screens it loads itself.
 */
export function useLeadFirstContact(leadId: string, options: { prefetched?: boolean } = {}) {
  return useQuery({
    queryKey: firstContactKey(leadId),
    enabled: Boolean(leadId) && !options.prefetched,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FirstContact | null> => {
      const { data, error } = await supabase
        .from("lead_first_contacts")
        .select(FIRST_CONTACT_COLUMNS)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (error) throw error;
      return parseFirstContact(data);
    },
  });
}

/** Every recorded call / text for a lead, newest first. Loaded only when asked for. */
export function useLeadContactEvents(leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: contactEventsKey(leadId),
    enabled: Boolean(leadId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ContactEvent[]> => {
      const { data, error } = await supabase
        .from("lead_contact_events")
        .select("id, lead_id, kind, direction, occurred_at")
        .eq("lead_id", leadId)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ContactEvent[];
    },
  });
}

/** Manual override. `null` hands the lead back to the automatic Quo value. */
export function useSetFirstContact(leadId: string, user: { id: string } | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contact: ContactType | null) => {
      const { data, error } = await supabase.rpc("set_lead_first_contact", {
        p_lead_id: leadId,
        p_contact: contact,
      });
      if (error) throw error;
      return parseFirstContact({ lead_id: leadId, ...(data as Record<string, unknown> | null) });
    },
    onSuccess: (result, contact) => {
      queryClient.setQueryData(firstContactKey(leadId), result);
      // The save already succeeded; a logging failure must not look like a failed save.
      if (user) {
        void logActivity(user.id, contact ? "first_contact_set" : "first_contact_reset", "lead", leadId, {
          first_contact: contact ? CONTACT_LABELS[contact] : "Automatic (from Quo)",
        }).catch(() => undefined);
      }
    },
  });
}
