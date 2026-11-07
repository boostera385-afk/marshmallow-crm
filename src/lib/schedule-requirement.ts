import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { realtimeBus } from "@/lib/realtime";

/**
 * Saving a lead's customer schedule requirement, shared by the lead card, the lead
 * detail page and the "Customer Require New Schedule" prompts so they cannot drift.
 * After a successful save it announces the new value on the realtime bus, so an open
 * lead page updates its form and a later "Save Lead" cannot write back an old value.
 */
export const SCHEDULE_REQUIREMENT_SAVED = "lead-schedule-requirement-saved";
export interface ScheduleRequirementSaved { leadId: string; value: string | null }

export async function saveScheduleRequirement(params: {
  leadId: string;
  value: string;
  editor: { id?: string | null; name: string };
}): Promise<{ ok: boolean; value: string | null }> {
  const value = params.value.trim() ? params.value.trim() : null;
  const now = new Date().toISOString();
  const { error } = await supabase.from("leads").update({
    customer_schedule_requirements: value,
    last_edited_by: params.editor.id ?? null,
    last_edited_by_name: params.editor.name,
    updated_at: now,
    last_edited_at: now,
  } as never).eq("id", params.leadId);
  if (error) {
    toast.error("Failed to update schedule requirement");
    return { ok: false, value };
  }
  toast.success(value ? "Schedule requirement updated" : "Schedule requirement cleared");
  realtimeBus.dispatchEvent(new CustomEvent<ScheduleRequirementSaved>(SCHEDULE_REQUIREMENT_SAVED, { detail: { leadId: params.leadId, value } }));
  return { ok: true, value };
}

/** Listens for schedule requirement saves made anywhere in this tab. */
export function onScheduleRequirementSaved(listener: (saved: ScheduleRequirementSaved) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ScheduleRequirementSaved>).detail);
  realtimeBus.addEventListener(SCHEDULE_REQUIREMENT_SAVED, handler);
  return () => realtimeBus.removeEventListener(SCHEDULE_REQUIREMENT_SAVED, handler);
}

/** The tag a person or the AI sets when the customer asked for another day/time. */
export const NEW_SCHEDULE_TAG = "confirmation_sent";

/** True when a tag change should prompt for the customer's new schedule requirement. */
export function promptsForNewSchedule(previousTag: string | null | undefined, newTag: string | null | undefined): boolean {
  return newTag === NEW_SCHEDULE_TAG && previousTag !== NEW_SCHEDULE_TAG;
}

/** A request to show the app-wide "Customer requires a new schedule" prompt. */
export interface ScheduleRequirementPromptRequest {
  /** Stable id, so the same request (one tag change or one alert) shows once. */
  key: string;
  /** "manual": the person who set the tag, in their own tab. "ai": an AI alert. */
  source: "manual" | "ai";
  leadId?: string;
  /** Used to find the lead when only the job ID is known (AI alerts). */
  jobId?: string;
  customerName?: string | null;
  initialValue?: string | null;
  customerSaid?: string | null;
}
export const SCHEDULE_REQUIREMENT_PROMPT = "lead-schedule-requirement-prompt";

export function requestScheduleRequirementPrompt(request: ScheduleRequirementPromptRequest): void {
  realtimeBus.dispatchEvent(new CustomEvent<ScheduleRequirementPromptRequest>(SCHEDULE_REQUIREMENT_PROMPT, { detail: request }));
}

export function onScheduleRequirementPrompt(listener: (request: ScheduleRequirementPromptRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ScheduleRequirementPromptRequest>).detail);
  realtimeBus.addEventListener(SCHEDULE_REQUIREMENT_PROMPT, handler);
  return () => realtimeBus.removeEventListener(SCHEDULE_REQUIREMENT_PROMPT, handler);
}

/** The customer's words from an AI "Customer requires new schedule" alert message. */
export function customerSaidFromAlert(message: string | null | undefined): string | null {
  const match = (message ?? "").match(/Customer said: "([\s\S]*?)"\s*(?:\n|$)/);
  return match ? match[1].trim() || null : null;
}

/** True for the AI "Customer requires new schedule" alert (either server shape). */
export function isNewScheduleAlert(notification: { event_type?: string | null; event_kind?: string | null }): boolean {
  return notification.event_kind === "schedule_new_needed" || notification.event_type === "schedule_new_needed";
}
