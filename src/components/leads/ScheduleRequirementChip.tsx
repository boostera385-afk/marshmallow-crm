import { CalendarClock } from "lucide-react";

const CHIP_CLASS =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300";

interface Props {
  /** Short display form, e.g. "Nov 21 to Nov 24". Null when the lead has none. */
  summary: string | null;
  /** The saved requirement text, shown in full on hover. */
  full?: string;
  /** Opens the schedule editor; omit for read-only roles. */
  onEdit?: () => void;
}

/**
 * Schedule Requirement on the lead card. Always one line: a long requirement truncates
 * with the full text in the tooltip and accessible name, so the chip never grows into a
 * multi-line blob or pushes into neighbouring controls.
 */
export function ScheduleRequirementChip({ summary, full, onEdit }: Props) {
  if (!summary) {
    if (!onEdit) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Add schedule requirement"
        className={`${CHIP_CLASS} border-dashed opacity-80 transition-opacity hover:opacity-100`}
      >
        <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">Add schedule</span>
      </button>
    );
  }

  const label = `Schedule Requirement: ${full || summary}`;
  const content = (
    <>
      <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
      <span className="shrink-0 whitespace-nowrap opacity-80">Schedule:</span>
      <span className="min-w-0 truncate">{summary}</span>
    </>
  );

  if (!onEdit) {
    return (
      <span title={label} aria-label={label} className={CHIP_CLASS}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      title={`${label} - click to edit`}
      aria-label={`${label}. Edit schedule requirement`}
      className={`${CHIP_CLASS} transition-colors hover:bg-sky-500/20`}
    >
      {content}
    </button>
  );
}
