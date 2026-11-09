import React, { useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import {
  CalendarPlus,
  Calendar as CalendarIcon,
  Clock,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeInput } from "@/components/ui/time-input";

function format12Hour(timeStr: string): string {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const hDisplay = String(h).padStart(2, "0");
  const mDisplay = String(m).padStart(2, "0");
  return `${hDisplay}:${mDisplay} ${ampm}`;
}

function formatDatesAuto(dates: Date[]): string {
  if (!dates || dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length === 1) return format(sorted[0], "MMMM d, yyyy");

  const clusters: Date[][] = [];
  let currentCluster: Date[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const diffDays = differenceInCalendarDays(curr, prev);

    if (diffDays === 1) {
      currentCluster.push(curr);
    } else if (diffDays > 1) {
      clusters.push(currentCluster);
      currentCluster = [curr];
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const parts = clusters.map((cluster) => {
    if (cluster.length >= 2) {
      const start = cluster[0];
      const end = cluster[cluster.length - 1];
      return `${format(start, "MMMM d, yyyy")} to ${format(end, "MMMM d, yyyy")}`;
    }
    return format(cluster[0], "MMMM d, yyyy");
  });

  return parts.join(" or ");
}

interface MultiDateTimePickerProps {
  value: string | null;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export default function MultiDateTimePicker({
  value,
  onChange,
  readOnly,
}: MultiDateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [exactTime, setExactTime] = useState("");

  const handleOpenDialog = () => {
    setSelectedDates([]);
    setExactTime("");
    setOpen(true);
  };

  const getDisplayText = (): string => {
    if (!selectedDates || selectedDates.length === 0) return "No dates selected yet";
    return formatDatesAuto(selectedDates);
  };

  const handleConfirm = () => {
    if (!selectedDates || selectedDates.length === 0) return;
    const dateStr = formatDatesAuto(selectedDates);
    if (!dateStr) return;

    const timeStr = exactTime ? `at ${format12Hour(exactTime)}` : "";
    const formattedRequirement = timeStr ? `${dateStr} ${timeStr}`.trim() : dateStr;
    const existing = value ? value.trim() : "";
    const updated = existing ? `${existing}\n${formattedRequirement}` : formattedRequirement;

    onChange(updated);
    setOpen(false);
  };

  const hasDateSelection = selectedDates && selectedDates.length > 0;

  // Entries are one per line, which is how handleConfirm appends them.
  const entries = (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, i) => i !== index).join("\n"));
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The free-text box is gone: requirements are only ever added through the picker, so what
          is stored always parses back into dates. */}
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {entries.map((entry, index) => (
            <span
              key={`${entry}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-[12px] text-foreground"
            >
              <CalendarIcon className="h-3 w-3 shrink-0 text-primary" />
              {entry}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  aria-label={`Remove ${entry}`}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">No schedule requirement yet.</p>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenDialog}
            className="h-8 text-xs flex items-center gap-1.5 font-medium border-border/60 hover:bg-muted/50"
          >
            <CalendarPlus className="h-3.5 w-3.5 text-primary" />
            Add Date & Time
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px] max-h-[92vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40 shrink-0">
            <DialogTitle className="text-base font-semibold">
              Add Schedule Requirement
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Select one or multiple dates, a date range, and optional exact time.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Date Selection Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                  Select Date(s)
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Consecutive dates auto-range, separate dates multi-select
                </span>
              </div>

              {/* Integrated Responsive Calendar Container */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-2 flex flex-col items-center justify-center">
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(dates) => setSelectedDates(dates || [])}
                  className="pointer-events-auto"
                />

                {/* Selection Preview Badge */}
                <div className="w-full mt-2 pt-2 border-t border-border/30 flex items-center justify-between text-xs px-2">
                  <span className="text-muted-foreground text-[11px]">Selection:</span>
                  <span className="font-medium text-foreground text-[11px] text-right truncate max-w-[320px]">
                    {getDisplayText()}
                  </span>
                </div>
              </div>
            </div>

            {/* Optional Exact Time Section */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Exact Time (Optional)
                </Label>
                {exactTime && (
                  <button
                    type="button"
                    onClick={() => setExactTime("")}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear Time
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <TimeInput
                  aria-label="Exact time"
                  value={exactTime}
                  onChange={setExactTime}
                  className="h-9 flex-1 px-3 text-xs"
                />
                <span className="text-xs text-muted-foreground font-mono bg-muted/40 px-3 py-2 rounded-lg border border-border/40 whitespace-nowrap">
                  {exactTime ? format12Hour(exactTime) : "No time"}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border/40 bg-muted/10 shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!hasDateSelection}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Apply Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
