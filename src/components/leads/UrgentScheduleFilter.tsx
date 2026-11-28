import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Filter, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SCHEDULE_PRESETS,
  extractAllScheduledDateKeys,
  type UrgentScheduleFilter as UrgentScheduleFilterValue,
} from "@/lib/schedule-date-filter";

interface UrgentScheduleFilterProps {
  value: UrgentScheduleFilterValue;
  onChange: (value: UrgentScheduleFilterValue) => void;
  rows: Array<{ customer_schedule_requirements?: string | null }>;
}

export function urgentScheduleFilterLabel(value: UrgentScheduleFilterValue): string | null {
  switch (value.mode) {
    case "due":
      return "Overdue / Today";
    case "undated":
      return "No date given";
    case "range": {
      if (value.label) return value.label;
      const { from, to } = value.range;
      if (!from) return null;
      return to && to.getTime() !== from.getTime() ? `${format(from, "MMM d")} – ${format(to, "MMM d")}` : format(from, "MMM d");
    }
    default:
      return null;
  }
}

/** Filter button for the Schedule column header of the Urgent leads table. */
export function UrgentScheduleFilter({ value, onChange, rows }: UrgentScheduleFilterProps) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const active = value.mode !== "all";
  const label = urgentScheduleFilterLabel(value);
  const scheduledKeys = useMemo(() => (open && showCalendar ? extractAllScheduledDateKeys(rows) : new Set<string>()), [open, showCalendar, rows]);
  const calendarRange: DateRange | undefined = value.mode === "range" && value.range.from ? { from: value.range.from, to: value.range.to } : undefined;

  const pick = (next: UrgentScheduleFilterValue) => {
    onChange(next);
    setOpen(false);
  };

  const optionClass = (selected: boolean) =>
    cn(
      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
      selected && "bg-primary/10 text-primary",
    );

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setShowCalendar(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Schedule filter: ${label}` : "Filter by schedule"}
          title={active ? `Filtered: ${label}` : "Filter by schedule"}
          className={cn(
            "ml-1 inline-flex h-5 items-center gap-1 rounded-md px-1 align-middle normal-case tracking-normal transition-colors",
            active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <Filter className="h-3 w-3" />
          {active && <span className="max-w-[80px] truncate text-[10px] font-semibold">{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className={cn("z-[100] p-1.5", showCalendar ? "w-auto" : "w-56")}>
        {showCalendar ? (
          <div className="space-y-2 p-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Custom schedule range</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setShowCalendar(false)}>Back</Button>
            </div>
            <Calendar
              mode="range"
              selected={calendarRange}
              onSelect={(range) => onChange(range?.from ? { mode: "range", range: { from: range.from, to: range.to } } : { mode: "all" })}
              numberOfMonths={2}
              modifiers={{ hasSchedule: (day: Date) => scheduledKeys.has(format(day, "yyyy-MM-dd")) }}
              modifiersClassNames={{
                hasSchedule:
                  "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-sky-500 aria-selected:after:bg-white font-medium",
              }}
            />
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
              <span>Days with urgent schedules</span>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filter schedule</div>
            <button type="button" className={optionClass(value.mode === "due")} onClick={() => pick({ mode: "due" })}>
              <span>Overdue / Today</span>
              <span className="text-[10px] font-normal text-muted-foreground">Needs attention</span>
            </button>
            {SCHEDULE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={optionClass(value.mode === "range" && value.label === preset.sublabel)}
                onClick={() => pick({ mode: "range", range: preset.getRange(), label: preset.sublabel })}
              >
                <span>{preset.sublabel}</span>
                <span className="text-[10px] font-normal text-muted-foreground">{preset.label}</span>
              </button>
            ))}
            <button type="button" className={optionClass(value.mode === "range" && !value.label)} onClick={() => setShowCalendar(true)}>
              <span>Custom range…</span>
            </button>
            <button type="button" className={optionClass(value.mode === "undated")} onClick={() => pick({ mode: "undated" })}>
              <span>No date given</span>
            </button>
            {active && (
              <>
                <div className="my-1 h-px bg-border/40" />
                <button type="button" className={optionClass(false)} onClick={() => pick({ mode: "all" })}>
                  <span className="inline-flex items-center gap-1.5"><X className="h-3 w-3" />Clear filter</span>
                </button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
