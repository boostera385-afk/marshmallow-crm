import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { validatePaidChoice, type PaidAccessChoice, type PaidLeadAccess } from "@/lib/paid-lead-access";

interface Props {
  open: boolean;
  userName: string;
  /** The user's current grant, to start from when editing. */
  current?: Pick<PaidLeadAccess, "start_date" | "end_date"> | null;
  saving?: boolean;
  onCancel: () => void;
  onConfirm: (choice: PaidAccessChoice) => void;
}

/** Asked when an Admin switches Paid on for a user: how many paid leads to share. */
export default function PaidLeadAccessDialog({ open, userName, current, saving = false, onCancel, onConfirm }: Props) {
  const [mode, setMode] = useState<"all" | "range">("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const hasRange = Boolean(current?.start_date && current?.end_date);
    setMode(hasRange ? "range" : "all");
    setStart(current?.start_date ?? "");
    setEnd(current?.end_date ?? "");
    setError(null);
  }, [open, current?.start_date, current?.end_date]);

  const confirm = () => {
    const choice: PaidAccessChoice = mode === "all" ? { mode: "all" } : { mode: "range", start, end };
    const problem = validatePaidChoice(choice);
    setError(problem);
    if (!problem) onConfirm(choice);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base">Share paid leads with {userName}</DialogTitle>
          <DialogDescription className="text-xs">
            Choose which paid leads {userName} can see. The range uses the date each lead became paid (New York time), not when it was created.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={mode} onValueChange={(value) => { setMode(value as "all" | "range"); setError(null); }} className="gap-3">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="all" id="paid-access-all" />
            <Label htmlFor="paid-access-all" className="text-sm font-normal">All time — every paid lead</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="range" id="paid-access-range" />
            <Label htmlFor="paid-access-range" className="text-sm font-normal">Custom date range</Label>
          </div>
        </RadioGroup>

        {mode === "range" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="paid-access-start" className="text-xs">From</Label>
              <Input id="paid-access-start" type="date" value={start} max={end || undefined} onChange={(e) => { setStart(e.target.value); setError(null); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="paid-access-end" className="text-xs">To</Label>
              <Input id="paid-access-end" type="date" value={end} min={start || undefined} onChange={(e) => { setEnd(e.target.value); setError(null); }} />
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={confirm} disabled={saving}>{saving ? "Saving..." : "Share paid leads"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
