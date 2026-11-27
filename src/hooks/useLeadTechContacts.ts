import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToTableChanges } from "@/lib/realtime";
import { logActivity } from "@/lib/activity";
import { parseTechContact, TECH_STATE_LABELS, type LeadTechContact, type TechContactState } from "@/lib/tech-status";
import { parseTechChat } from "@/lib/tech-chat";

// lead_tech_contacts / set_lead_tech_contact_state: migration 20261127061449.
const TECH_COLUMNS =
  "id, lead_id, tech_number, name, phone, state, state_source, contacted_at, verdict, verdict_reason, evidence_quote, evidence_at, evidence_source, verdict_checked_at, processor_note";

export const TECH_CONTACTS_KEY = ["lead-tech-contacts"] as const;

/** Feature Access section that shows AI Tech Status (navigation_permissions.nav_section). */
export const TECH_STATUS_SECTION = "tech_status";

/**
 * Who sees AI Tech Status: Admin and Processor by default; Admin can switch it on for anyone
 * (or off for a Processor) in Settings > Feature Access. RLS on lead_tech_contacts applies the
 * same rule (marshmallow_private.can_see_tech_status, migration 20261127085131).
 */
export function canSeeTechStatus(role: string | null | undefined, canAccess: (navItem: string) => boolean): boolean {
  return role === "admin" || canAccess(TECH_STATUS_SECTION);
}

/** Marking techs Not Texted / Texted / Called stays with Admin and Processor (the RPC checks it). */
export function canEditTechTracking(role: string | null | undefined): boolean {
  return role === "admin" || role === "processor";
}

function parseRows(data: unknown): LeadTechContact[] {
  return ((data ?? []) as unknown[])
    .map(parseTechContact)
    .filter((row): row is LeadTechContact => row !== null)
    .sort((a, b) => a.tech_number - b.tech_number);
}

/** Any change to tracked techs refreshes every tech query on screen (one shared channel). */
function useTechContactsRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return subscribeToTableChanges("lead_tech_contacts", () => {
      void queryClient.invalidateQueries({ queryKey: TECH_CONTACTS_KEY });
    });
  }, [enabled, queryClient]);
}

export function useLeadTechContacts(leadId: string, enabled: boolean) {
  useTechContactsRealtime(enabled);
  return useQuery({
    queryKey: [...TECH_CONTACTS_KEY, "lead", leadId],
    enabled: enabled && Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tech_contacts")
        .select(TECH_COLUMNS)
        .eq("lead_id", leadId);
      if (error) throw error;
      return parseRows(data);
    },
  });
}

/** Techs for many leads (the urgent table), grouped by lead. */
export function useTechContactsForLeads(leadIds: string[], enabled: boolean) {
  const idsKey = useMemo(() => [...new Set(leadIds)].sort().join(","), [leadIds]);
  useTechContactsRealtime(enabled && idsKey.length > 0);
  return useQuery({
    queryKey: [...TECH_CONTACTS_KEY, "batch", idsKey],
    enabled: enabled && idsKey.length > 0,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tech_contacts")
        .select(TECH_COLUMNS)
        .in("lead_id", idsKey.split(","));
      if (error) throw error;
      const byLead = new Map<string, LeadTechContact[]>();
      for (const row of parseRows(data)) {
        const list = byLead.get(row.lead_id) ?? [];
        list.push(row);
        byLead.set(row.lead_id, list);
      }
      return byLead;
    },
  });
}

/** Plain call so the processor notes form can use it without a query context. */
export async function setTechContactState(leadId: string, techNumber: number, state: TechContactState) {
  const { data, error } = await supabase.rpc("set_lead_tech_contact_state", {
    p_lead_id: leadId,
    p_tech_number: techNumber,
    p_state: state,
  });
  if (error) throw error;
  return parseTechContact(data);
}

/**
 * Ask the server to re-read tracked techs' Quo chats. Advisory: callers report a failure here
 * separately from the save that triggered it.
 */
export async function requestTechStatusCheck(leadIds: string[], force = false) {
  const { data, error } = await supabase.functions.invoke("lead-tech-status", { body: { leadIds, force } });
  if (error) {
    let message = error.message || "Could not check tech chats";
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    if (body?.error) message = String(body.error);
    throw new Error(message);
  }
  return data as { checked: number; model_calls: number; deferred: number; failed: number; warning?: string };
}

export function useSetTechContactState(leadId: string, user: { id: string } | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ techNumber, state }: { techNumber: number; state: TechContactState }) =>
      setTechContactState(leadId, techNumber, state),
    onSuccess: (_row, { techNumber, state }) => {
      void queryClient.invalidateQueries({ queryKey: TECH_CONTACTS_KEY });
      if (user) {
        void logActivity(user.id, "tech_contact_state_set", "lead", leadId, {
          tech: `Tech ${techNumber}`,
          state: TECH_STATE_LABELS[state],
        }).catch(() => undefined);
      }
    },
  });
}

export function useCheckTechStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadIds, force }: { leadIds: string[]; force?: boolean }) => requestTechStatusCheck(leadIds, force),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TECH_CONTACTS_KEY }),
  });
}

/**
 * One tech's saved Quo chat for this job (read-only). Loaded only while the chat is open and
 * refreshed every 30 s so a new reply shows up without reopening.
 */
export function useLeadTechChat(leadId: string, techNumber: number | null) {
  return useQuery({
    queryKey: ["lead-tech-chat", leadId, techNumber],
    enabled: Boolean(leadId) && techNumber !== null,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_lead_tech_chat", { p_lead_id: leadId, p_tech_number: techNumber as number });
      if (error) throw error;
      return parseTechChat(data);
    },
  });
}
