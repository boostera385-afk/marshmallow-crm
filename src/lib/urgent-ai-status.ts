export const URGENT_AI_STATUS_CLASSES: Record<string, string> = {
  "Awaiting Response": "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "Awaiting Schedule": "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "Schedule Confirmed": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "Schedule Confirmation Pending": "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "New Schedule": "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "Quote Rejected": "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "Need to Cancel": "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  "Need Requote": "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

const FALLBACK_CLASSES = [
  "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
] as const;

export function urgentAiStatusClass(status: string): string {
  const preferred = URGENT_AI_STATUS_CLASSES[status];
  if (preferred) return preferred;
  let hash = 0;
  for (const character of status) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return FALLBACK_CLASSES[hash % FALLBACK_CLASSES.length];
}
