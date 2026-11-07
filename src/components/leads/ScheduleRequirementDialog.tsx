import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveScheduleRequirement } from "@/lib/schedule-requirement";
import MultiDateTimePicker from "./MultiDateTimePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  customerName: string | null | undefined;
  /** The requirement saved on the lead now; the picker starts from it. */
  initialValue: string | null | undefined;
  editor: { id?: string | null; name: string };
  /** "new-schedule": opened because the customer needs a new schedule. */
  reason?: "edit" | "new-schedule";
  /** The customer's own words, when the AI set the tag. */
  customerSaid?: string | null;
  onSaved?: (value: string | null) => void;
}

/** Add or update a lead's customer schedule requirement. */
export default function ScheduleRequirementDialog({
  open, onOpenChange, leadId, customerName, initialValue, editor, reason = "edit", customerSaid, onSaved,
}: Props) {
  const [draft, setDraft] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  // Start from the saved value each time the dialog opens.
  useEffect(() => { if (open) setDraft(initialValue ?? ""); }, [open, initialValue]);

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const { ok, value } = await saveScheduleRequirement({ leadId, value: draft, editor });
      if (ok) {
        onSaved?.(value);
        onOpenChange(false);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const newSchedule = reason === "new-schedule";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[460px]" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-base">{newSchedule ? "Customer requires a new schedule" : "Customer Schedule Requirement"}</DialogTitle>
          <DialogDescription className="text-xs">
            {newSchedule
              ? `${customerName || "This customer"} needs a new schedule. Add or update the dates and times the customer is available.`
              : `${customerName || "Customer"} - add or remove the dates the customer is available.`}
          </DialogDescription>
        </DialogHeader>

        {customerSaid && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Customer said: “{customerSaid}”
          </p>
        )}

        <MultiDateTimePicker value={draft} onChange={setDraft} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {newSchedule ? "Later" : "Cancel"}
          </Button>
          <Button onClick={() => { void save(); }} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
