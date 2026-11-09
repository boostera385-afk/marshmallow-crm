import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TimeInput } from "@/components/ui/time-input";

interface BookingDateTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: string | null;
  onConfirm: (isoString: string) => Promise<void> | void;
  title?: string;
}

export default function BookingDateTimeDialog({
  open,
  onOpenChange,
  initialValue,
  onConfirm,
  title = "Set Booking Date & Time",
}: BookingDateTimeDialogProps) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string>("09:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialValue) {
      const d = new Date(initialValue);
      if (!isNaN(d.getTime())) {
        setDate(d);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        setTime(`${hh}:${mm}`);
        return;
      }
    }
    setDate(undefined);
    setTime("09:00");
  }, [open, initialValue]);

  const handleConfirm = async () => {
    if (!date || !time) return;
    const [h, m] = time.split(":").map((v) => parseInt(v, 10));
    const combined = new Date(date);
    combined.setHours(h || 0, m || 0, 0, 0);
    setSaving(true);
    try {
      await onConfirm(combined.toISOString());
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose the date and time for this booking. The Booked tag will be applied after you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Booking Date
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="booking-time" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Booking Time
            </Label>
            <TimeInput
              id="booking-time"
              value={time}
              onChange={setTime}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!date || !time || saving}>
            {saving ? "Saving..." : "Confirm Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function formatBookingCompact(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${format(d, "MMM d")} • ${format(d, "h:mm a")}`;
}

export function isBookingExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}
