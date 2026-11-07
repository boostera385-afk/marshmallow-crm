import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { onScheduleRequirementPrompt, type ScheduleRequirementPromptRequest } from "@/lib/schedule-requirement";
import ScheduleRequirementDialog from "./ScheduleRequirementDialog";

interface PromptLead { key: string; leadId: string; jobId: string | null; customerName: string | null; initialValue: string | null; customerSaid: string | null }

/**
 * App-wide "Customer requires a new schedule" prompt. Opened after a person sets the
 * Customer Require New Schedule tag, and for CS / CS Admin when the AI sets it. Lives
 * at the app level so it survives the lead card leaving the list after its tag change.
 * Requests queue and each one shows once; the lead is re-read so the picker starts
 * from the saved requirement. For AI alerts a CS is asked only for leads they created.
 */
export default function ScheduleRequirementPrompt() {
  const { user, role, profile } = useAuth();
  const [queue, setQueue] = useState<PromptLead[]>([]);
  const seen = useRef(new Set<string>());
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    return onScheduleRequirementPrompt((request: ScheduleRequirementPromptRequest) => {
      if (seen.current.has(request.key) || (!request.leadId && !request.jobId)) return;
      seen.current.add(request.key);
      void (async () => {
        let query = supabase.from("leads").select("id, job_id, customer_name, customer_schedule_requirements, created_by, assigned_cs");
        query = request.leadId ? query.eq("id", request.leadId) : query.eq("job_id", request.jobId!);
        const { data } = await query.maybeSingle();
        // No access (RLS) or the lead is gone: nothing to prompt for.
        if (!data) return;
        // AI alerts: among CS users, only the CS who created the lead is asked
        // (assigned or shared CS still get the alert itself). A manual tag change
        // prompts only the person who made it, in their own tab.
        if (request.source === "ai" && role === "customer_service" && data.created_by !== userId) return;
        setQueue((current) => current.some((item) => item.leadId === data.id) ? current : [...current, {
          key: request.key, leadId: data.id, jobId: data.job_id ?? null, customerName: data.customer_name ?? request.customerName ?? null,
          initialValue: data.customer_schedule_requirements ?? null, customerSaid: request.customerSaid ?? null,
        }]);
      })();
    });
  }, [userId, role]);

  const current = queue[0];
  if (!current || !user) return null;
  const close = () => setQueue((items) => items.slice(1));
  const name = [current.customerName, current.jobId].filter(Boolean).join(" · ");
  return (
    <ScheduleRequirementDialog
      key={current.key}
      open
      onOpenChange={(open) => { if (!open) close(); }}
      leadId={current.leadId}
      customerName={name || null}
      initialValue={current.initialValue}
      editor={{ id: user.id, name: profile?.full_name || user.email || "Unknown user" }}
      reason="new-schedule"
      customerSaid={current.customerSaid}
    />
  );
}
