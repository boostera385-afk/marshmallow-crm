import { urgentAiStatusClass } from "@/lib/urgent-ai-status";

/**
 * AI Status pill for the Urgent leads table. It never grows past its column: long labels
 * (e.g. "Schedule Confirmation Pending") truncate with an ellipsis and keep the full
 * text as a tooltip and accessible name, instead of spilling over the next column.
 */
export function UrgentAiStatusBadge({ status }: { status: string }) {
  return (
    <span
      title={status}
      className={`inline-block max-w-full truncate whitespace-nowrap rounded-full border px-1.5 py-0.5 align-middle ${urgentAiStatusClass(status)}`}
    >
      {status}
    </span>
  );
}
