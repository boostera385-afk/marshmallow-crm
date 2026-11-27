/**
 * Techs recorded in the processor notes thread.
 *
 * The "Add tech" dialog writes one line per tech so entries can be counted later without a
 * schema change:
 *
 *   Tech 1: John - (305) 555-0123 - he is available
 *
 * The number keeps entries ordered and countable; everything after the colon is the plain
 * reading order the team asked for. Counting stays forgiving about spacing and case, since
 * notes are free text people edit by hand afterwards, and still recognises the older
 * heading-only shape.
 */

const TECH_HEADING = /^[ \t]*tech[ \t]*#?[ \t]*(\d+)[ \t]*(?::|-|–|$)/gim;

/** Every tech number found in a note body, in the order they appear. */
export function findTechNumbers(content: string | null | undefined): number[] {
  if (!content) return [];

  const numbers: number[] = [];
  // Regex carries the global flag, so reset before each use.
  TECH_HEADING.lastIndex = 0;

  let match = TECH_HEADING.exec(content);
  while (match !== null) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) numbers.push(parsed);
    match = TECH_HEADING.exec(content);
  }

  return numbers;
}

/** How many techs are recorded across a set of note bodies. */
export function countTechs(contents: Array<string | null | undefined>): number {
  return contents.reduce((total, content) => total + findTechNumbers(content).length, 0);
}

/**
 * The number the next tech should get: one past the highest already used, so deleting Tech 2
 * of 3 does not hand out a number that is still on screen.
 */
export function nextTechNumber(contents: Array<string | null | undefined>): number {
  const highest = contents.reduce((max, content) => {
    return findTechNumbers(content).reduce((inner, n) => Math.max(inner, n), max);
  }, 0);

  return highest + 1;
}

/**
 * One tech as a single line: "Tech 1: John - (305) 555-0123 - he is available".
 * An empty number or note is dropped rather than left as a dangling dash.
 */
export function buildTechEntry(
  techNumber: number,
  fields: { name: string; phone?: string | null; note?: string | null; contact?: string | null },
): string {
  // The contact word ("Texted" / "Called" / "Not texted") sits right after the number, where
  // processors already write it; the database reads it to start AI tracking.
  const parts = [
    fields.name.trim(),
    (fields.phone ?? "").trim(),
    (fields.contact ?? "").trim(),
    (fields.note ?? "").trim(),
  ].filter(Boolean);

  return `Tech ${techNumber}: ${parts.join(" - ")}`;
}

/** "3 techs" / "1 tech" — the summary shown on the collapsed notes row. */
export function formatTechCount(count: number): string {
  return `${count} ${count === 1 ? "tech" : "techs"}`;
}
