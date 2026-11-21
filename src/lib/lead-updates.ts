import { supabase } from "@/integrations/supabase/client";

type LeadUpdatePayload = Record<string, unknown>;

export const NO_ROW_UPDATED_MESSAGE = "Lead update was not applied. Check your permissions and refresh the page.";

export async function updateLeadById(leadId: string, changes: LeadUpdatePayload) {
  if (!leadId) {
    throw new Error("Missing lead ID for update.");
  }

  // Strip undefined values and convert NaN to null
  const cleanChanges: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) {
      cleanChanges[key] = typeof value === "number" && Number.isNaN(value) ? null : value;
    }
  }

  const { error, count } = await supabase
    .from("leads")
    .update(cleanChanges as never, { count: "exact" })
    .eq("id", leadId);

  if (error) {
    console.error("updateLeadById failed:", error);
    throw new Error(error.message || NO_ROW_UPDATED_MESSAGE);
  }
  if (count !== 1) throw new Error(NO_ROW_UPDATED_MESSAGE);

  return { id: leadId };
}
