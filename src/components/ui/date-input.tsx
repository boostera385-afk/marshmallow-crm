import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ISO_DAY = "yyyy-MM-dd";

/** "2026-11-01" -> local Date (no time-zone shift), or undefined. */
export function parseIsoDay(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parse(value, ISO_DAY, new Date());
  return isValid(date) ? date : undefined;
}

export const toIsoDay = (date: Date) => format(date, ISO_DAY);

export interface DateInputProps {
  /** YYYY-MM-DD, or "" for no date (same value a native date input uses). */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Hide "Clear" when a date is mandatory. */
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Themed replacement for <input type="date">: looks like our Input and opens
 * the app's Calendar instead of the browser's own picker.
 */
export const DateInput = React.forwardRef<HTMLButtonElement, DateInputProps>(function DateInput(
  { value, onChange, id, min, max, disabled, required, placeholder = "Pick a date", className, "aria-label": ariaLabel },
  ref,
) {
  const [open, setOpen] = React.useState(false);
  const selected = parseIsoDay(value);
  const minDate = parseIsoDay(min);
  const maxDate = parseIsoDay(max);
  const today = new Date();
  const todayAllowed = (!minDate || toIsoDay(today) >= toIsoDay(minDate)) && (!maxDate || toIsoDay(today) <= toIsoDay(maxDate));

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

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
          data-empty={selected ? undefined : ""}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input/75 bg-[hsl(var(--card)/0.74)] px-4 py-2.5 text-left text-[14px] text-foreground shadow-[0_10px_24px_-20px_rgba(37,99,235,0.18)] ring-offset-background transition-[border-color,box-shadow,background-color] duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-0 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground/72")}>
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[100] w-auto p-0" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (maxDate && maxDate < today ? maxDate : minDate && minDate > today ? minDate : undefined)}
          onSelect={(date) => { if (date) choose(toIsoDay(date)); }}
          disabled={disabledDays}
          initialFocus
        />
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
          {required ? <span /> : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => choose("")} disabled={!value}>
              Clear
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary" onClick={() => choose(toIsoDay(today))} disabled={!todayAllowed}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
