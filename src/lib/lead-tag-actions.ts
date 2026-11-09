import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CS_TAG_LABELS, type CsTag, type Lead } from "@/types";

/**
 * Saving a lead tag, shared by the lead card and the lead detail page so the two cannot drift:
 * the booked_at bookkeeping and the Incomplete details alert all live here
 * rather than in each screen. Google Sheets is updated from the database
 * outbox trigger, not from this browser action.
 */

type TaggableLead = Pick<Lead, "id" | "customer_name" | "created_by"> & {
  cs_tag?: string | null;
  booked_at?: string | null;
};

export interface SaveLeadTagOptions {
  /** Present (even as null) to set booked_at explicitly; absent to leave it unless leaving Booked. */
  bookedAt?: string | null;
  /** Replaces the default "Tag: X" toast, e.g. when only the booking time changed. */
  successMessage?: string;
}

export async function saveLeadTag(params: {
  lead: TaggableLead;
  newTag: CsTag | null;
  editor: { id?: string | null; name: string };
  options?: SaveLeadTagOptions;
}): Promise<{ ok: boolean; patch: Record<string, unknown> }> {
  const { lead, newTag, editor, options = {} } = params;
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {
    cs_tag: newTag,
    last_edited_by: editor.id ?? null,
    last_edited_by_name: editor.name,
    updated_at: now,
    last_edited_at: now,
  };

  // Only touch booked_at when the tag transition affects it: on "booked" save the picked
  // timestamp; on any move away from booked, clear it.
  if (Object.prototype.hasOwnProperty.call(options, "bookedAt")) {
    patch.booked_at = options.bookedAt;
  } else if (newTag !== "booked" && lead.cs_tag === "booked") {
    patch.booked_at = null;
  }

  const { error } = await supabase.from("leads").update(patch as never).eq("id", lead.id);
  if (error) {
    toast.error("Failed to update tag");
    return { ok: false, patch };
  }

  // Incomplete Details: the lead's creator and CS Admins are notified by the database
  // when the tag is saved (leads_notify_change), in the same transaction as the tag.

  toast.success(options.successMessage ?? (newTag ? `Tag: ${CS_TAG_LABELS[newTag]}` : "Tag cleared"));
  return { ok: true, patch };
}
