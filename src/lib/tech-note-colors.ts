/**
 * Per-tech colours for the processor notes thread (option C from the colour samples).
 *
 * A note that starts with a "Tech N:" heading (as written by the tech form, see
 * lead-techs.ts) is drawn in tech N's colour with a "TECH N" chip, so Tech 1 and Tech 2
 * never look alike. Other notes keep the normal bubble. Display only: the saved note text
 * is never changed.
 */

export interface TechNoteColor {
  /** Classes for the bubble background, border and text. */
  bubble: string;
  /** Classes for the "TECH N" chip. */
  chip: string;
}

// Literal class strings so Tailwind keeps them. Cycles after six techs.
export const TECH_NOTE_COLORS: readonly TechNoteColor[] = [
  {
    bubble: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/50 dark:bg-sky-500/15 dark:text-sky-50",
    chip: "border-sky-400 text-sky-700 dark:border-sky-400/60 dark:text-sky-200",
  },
  {
    bubble: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-50",
    chip: "border-emerald-400 text-emerald-700 dark:border-emerald-400/60 dark:text-emerald-200",
  },
  {
    bubble: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-50",
    chip: "border-amber-400 text-amber-700 dark:border-amber-400/60 dark:text-amber-200",
  },
  {
    bubble: "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-violet-50",
    chip: "border-violet-400 text-violet-700 dark:border-violet-400/60 dark:text-violet-200",
  },
  {
    bubble: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-50",
    chip: "border-rose-400 text-rose-700 dark:border-rose-400/60 dark:text-rose-200",
  },
  {
    bubble: "border-teal-300 bg-teal-50 text-teal-950 dark:border-teal-500/50 dark:bg-teal-500/15 dark:text-teal-50",
    chip: "border-teal-400 text-teal-700 dark:border-teal-400/60 dark:text-teal-200",
  },
];

// Same heading shape lead-techs.ts counts, anchored to the start of the note.
const LEADING_TECH_HEADING = /^\s*tech[ \t]*#?[ \t]*(\d+)[ \t]*(?::|-|–)?[ \t]*/i;

export interface TechNoteDisplay {
  techNumber: number;
  /** The note text after the "Tech N:" heading (the chip shows the heading). */
  body: string;
  color: TechNoteColor;
}

/** How a processor note should be coloured, or null when it is not a tech entry. */
export function techNoteDisplay(content: string | null | undefined): TechNoteDisplay | null {
  if (!content) return null;
  const match = LEADING_TECH_HEADING.exec(content);
  if (!match) return null;
  const techNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(techNumber) || techNumber < 1) return null;
  return {
    techNumber,
    body: content.slice(match[0].length),
    color: TECH_NOTE_COLORS[(techNumber - 1) % TECH_NOTE_COLORS.length],
  };
}
