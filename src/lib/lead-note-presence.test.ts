import { describe, expect, it } from "vitest";
import { mergeNotePresence } from "./lead-note-presence";

const none = { general: false, cs: false, processor: false, opr: false };
const page = {
  a: { hasNotes: { ...none }, techCount: 0, photoCount: 2 },
  b: { hasNotes: { ...none, general: true }, techCount: 0, photoCount: 0 },
};

describe("mergeNotePresence", () => {
  it("lights the CS dot when another user adds a CS note, keeping other card fields", () => {
    const next = mergeNotePresence(page, ["a"], [{ lead_id: "a", note_type: "cs", content: "called customer" }]);
    expect(next.a).toEqual({ hasNotes: { ...none, cs: true }, techCount: 0, photoCount: 2 });
    expect(next.b).toBe(page.b);
  });

  it("recounts techs from processor notes", () => {
    const next = mergeNotePresence(page, ["a"], [
      { lead_id: "a", note_type: "processor", content: "Tech 1: Sam\nTech 2: Ali" },
    ]);
    expect(next.a.hasNotes.processor).toBe(true);
    expect(next.a.techCount).toBe(2);
  });

  it("clears a dot when the last note of that type is gone", () => {
    const next = mergeNotePresence(page, ["b"], []);
    expect(next.b.hasNotes).toEqual(none);
  });

  it("returns the same object when nothing changed or the lead is not on the page", () => {
    expect(mergeNotePresence(page, ["b"], [{ lead_id: "b", note_type: "general", content: "x" }])).toBe(page);
    expect(mergeNotePresence(page, ["zzz"], [{ lead_id: "zzz", note_type: "cs", content: "x" }])).toBe(page);
  });
});
