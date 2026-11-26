import { countTechs } from "@/lib/lead-techs";

export type NotePresence = { general: boolean; cs: boolean; processor: boolean; opr: boolean };
export type NotePresenceRow = { lead_id: string; note_type: string | null; content: string | null };
type CardMeta = { hasNotes: NotePresence; techCount: number };

/**
 * Re-derives the note dots and processor tech count for the given leads from a
 * fresh read of their notes, keeping every other card field. Leads not already
 * on the page are ignored; returns `prev` itself when nothing changed so React
 * skips the re-render.
 */
export function mergeNotePresence<T extends CardMeta>(
  prev: Record<string, T>,
  leadIds: string[],
  rows: NotePresenceRow[],
): Record<string, T> {
  let next: Record<string, T> | null = null;
  for (const id of leadIds) {
    const item = prev[id];
    if (!item) continue;
    const own = rows.filter((row) => row.lead_id === id);
    const types = new Set(own.map((row) => row.note_type));
    const hasNotes: NotePresence = {
      general: types.has("general"),
      cs: types.has("cs"),
      processor: types.has("processor"),
      opr: types.has("opr"),
    };
    const techCount = countTechs(own.filter((row) => row.note_type === "processor").map((row) => row.content ?? ""));
    const same = techCount === item.techCount
      && (Object.keys(hasNotes) as (keyof NotePresence)[]).every((key) => hasNotes[key] === item.hasNotes[key]);
    if (same) continue;
    next ??= { ...prev };
    next[id] = { ...item, hasNotes, techCount };
  }
  return next ?? prev;
}
