import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { getAssignableLeadTags } from "@/lib/lead-tags";
import { saveLeadTag } from "@/lib/lead-tag-actions";
import { CS_TAG_LABELS, type CsTag, type Lead } from "@/types";
import BookingDateTimeDialog, { formatBookingCompact, isBookingExpired } from "./BookingDateTimeDialog";
import AiTagBadge from "./AiTagBadge";

interface Props {
  lead: Lead;
  /** Called with what was written, so the page can update its copy of the lead in place. */
  onSaved: (patch: { cs_tag: CsTag | null; cs_tag_source: null; booked_at?: string | null }) => void;
  className?: string;
}

/**
 * The lead tag picker on the lead detail page: the same tags, permissions and side effects as
 * the card, because both save through saveLeadTag. It saves immediately, as on the card, rather
 * than waiting for Save Lead.
 */
export default function LeadTagControl({ lead, onSaved, className }: Props) {
  const { user, role, profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingMode, setBookingMode] = useState<"add" | "edit">("add");

  const isOpr = isOperatorRole(role);
  const currentTag = (lead.cs_tag ?? null) as CsTag | null;
  const assignableTags = getAssignableLeadTags(role, { isQuotationMaster: profile?.is_quotation_master });
  const editor = { id: user?.id, name: profile?.full_name || user?.email || "Unknown user" };

  const persist = async (newTag: CsTag | null, options?: { bookedAt?: string | null; successMessage?: string }) => {
    setSaving(true);
    const { ok, patch } = await saveLeadTag({ lead, newTag, editor, options });
    setSaving(false);

    if (ok) {
      onSaved({
        cs_tag: newTag,
        // A person's tag change clears the AI marker in the database too.
        cs_tag_source: null,
        ...(Object.prototype.hasOwnProperty.call(patch, "booked_at")
          ? { booked_at: patch.booked_at as string | null }
          : {}),
      });
    }
  };

  const handleChange = (value: string) => {
    const newTag = value === "__clear__" ? null : (value as CsTag);
    if (newTag && !assignableTags.includes(newTag)) return;

    // Booked needs a date and time before it is applied, exactly as on the card.
    if (newTag === "booked") {
      setBookingMode("add");
      setBookingOpen(true);
      return;
    }

    void persist(newTag);
  };

  return (
    <div className={className}>
      <Select value={currentTag ?? "__clear__"} onValueChange={handleChange} disabled={isOpr || saving}>
        <SelectTrigger className="h-10 rounded-xl text-[13px]">
          <SelectValue placeholder="Lead tag (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear__" className="text-muted-foreground">
            No tag
          </SelectItem>
          {currentTag && !assignableTags.includes(currentTag) && (
            <SelectItem value={currentTag} disabled>
              {CS_TAG_LABELS[currentTag] ?? currentTag} (view only)
            </SelectItem>
          )}
          {assignableTags.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {CS_TAG_LABELS[tag]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <AiTagBadge lead={lead} className="mt-2" />

      {currentTag === "booked" && lead.booked_at && (
        <button
          type="button"
          disabled={isOpr}
          onClick={() => {
            setBookingMode("edit");
            setBookingOpen(true);
          }}
          title="Edit booking date/time"
          className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            isBookingExpired(lead.booked_at)
              ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300"
              : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          <CalendarDays className="h-3 w-3" />
          {formatBookingCompact(lead.booked_at)}
        </button>
      )}

      <BookingDateTimeDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        initialValue={bookingMode === "edit" ? lead.booked_at : null}
        title={bookingMode === "edit" ? "Edit Booking Date & Time" : "Set Booking Date & Time"}
        onConfirm={async (iso) => {
          await persist("booked", {
            bookedAt: iso,
            successMessage: bookingMode === "edit" ? "Booking time updated" : undefined,
          });
          setBookingOpen(false);
        }}
      />
    </div>
  );
}
