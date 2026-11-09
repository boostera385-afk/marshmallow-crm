import * as React from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTimeLabel, formatTimeValue, parseTime, type TimeParts } from "@/lib/time-value";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const DEFAULT_PARTS: TimeParts = { hour12: 9, minute: 0, pm: false };

export interface TimeInputProps {
  /** "HH:mm" (or "HH:mm:ss" from the database), or "" for no time. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  /** Hide "Clear" when a time is mandatory. */
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

function Column<T>({ label, items, selected, render, onPick }: {
  label: string; items: T[]; selected: T | undefined; render: (item: T) => string; onPick: (item: T) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    active?.scrollIntoView?.({ block: "center" });
  }, []);
  return (
    <div ref={listRef} role="group" aria-label={label} className="flex max-h-56 w-14 flex-col gap-0.5 overflow-y-auto px-1 py-1">
      {items.map((item) => {
        const isSelected = item === selected;
        return (
          <button
            key={String(item)}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onPick(item)}
            className={cn(
              "h-8 shrink-0 rounded-md text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              isSelected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {render(item)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Themed replacement for <input type="time">: looks like our Input and opens
 * hour / minute / AM-PM columns instead of the browser's own picker. Every
 * minute stays selectable, so saved times are never rounded.
 */
export const TimeInput = React.forwardRef<HTMLButtonElement, TimeInputProps>(function TimeInput(
  { value, onChange, id, disabled, required, placeholder = "Pick a time", className, "aria-label": ariaLabel },
  ref,
) {
  const [open, setOpen] = React.useState(false);
  const parts = parseTime(value);
  const base = parts ?? DEFAULT_PARTS;
  const set = (patch: Partial<TimeParts>) => onChange(formatTimeValue({ ...base, ...patch }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input/75 bg-[hsl(var(--card)/0.74)] px-4 py-2.5 text-left text-[14px] text-foreground shadow-[0_10px_24px_-20px_rgba(37,99,235,0.18)] ring-offset-background transition-[border-color,box-shadow,background-color] duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-0 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !parts && "text-muted-foreground/72")}>
            {parts ? formatTimeLabel(parts) : placeholder}
          </span>
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[100] w-auto p-0" align="start" sideOffset={6}>
        <div className="flex divide-x divide-border/60 p-1">
          <Column label="Hour" items={HOURS} selected={parts?.hour12} render={String} onPick={(hour12) => set({ hour12 })} />
          <Column label="Minute" items={MINUTES} selected={parts?.minute} render={(m) => String(m).padStart(2, "0")} onPick={(minute) => set({ minute })} />
          <Column label="AM or PM" items={["AM", "PM"]} selected={parts ? (parts.pm ? "PM" : "AM") : undefined} render={String} onPick={(half) => set({ pm: half === "PM" })} />
        </div>
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
          {required ? <span /> : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { onChange(""); setOpen(false); }} disabled={!value}>
              Clear
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
