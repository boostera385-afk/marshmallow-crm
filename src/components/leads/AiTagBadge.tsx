import { Sparkles } from "lucide-react";
import { isAiSetTag } from "@/lib/lead-tags";

const AI_TAG_TITLES: Record<string, string> = {
  ready_to_schedule: "Set by AI: the customer confirmed the schedule in Quo",
  confirmation_sent: "Set by AI: the customer asked for a different day or time in Quo",
};

/** Small "AI" marker shown next to a tag the schedule confirmation AI set. */
export default function AiTagBadge({ lead, className = "" }: { lead: { cs_tag?: string | null; cs_tag_source?: string | null }; className?: string }) {
  if (!isAiSetTag(lead)) return null;
  const title = AI_TAG_TITLES[lead.cs_tag ?? ""];
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-0.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300 ${className}`}
    >
      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
      AI
    </span>
  );
}
