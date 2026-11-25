import { describe, expect, it } from "vitest";
import { buildTechEntry } from "./lead-techs";
import { TECH_NOTE_COLORS, personNoteColor, techNoteDisplay } from "./tech-note-colors";

describe("personNoteColor", () => {
  it("gives the same person the same colour every time", () => {
    expect(personNoteColor("user-sara")).toBe(personNoteColor("user-sara"));
    expect(personNoteColor(" user-sara ")).toBe(personNoteColor("user-sara"));
  });

  it("never uses the sky blue reserved to look like my own notes", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `user-${i}`);
    for (const id of ids) expect(personNoteColor(id)).not.toBe(TECH_NOTE_COLORS[0]);
    // ...and spreads people across several colours.
    expect(new Set(ids.map(personNoteColor)).size).toBeGreaterThan(2);
  });

  it("falls back to one colour for missing authors", () => {
    expect(personNoteColor(null)).toBe(personNoteColor(""));
  });
});

describe("techNoteDisplay", () => {
  it("colours a tech entry by its number and splits off the heading", () => {
    const tech1 = techNoteDisplay(buildTechEntry(1, { name: "Michael", phone: "(785) 816-5182", note: "texted" }));
    const tech2 = techNoteDisplay("Tech 2: Ronny - (816) 536-4348 - Monday 12-2pm");
    expect(tech1).toEqual({ techNumber: 1, body: "Michael - (785) 816-5182 - texted", color: TECH_NOTE_COLORS[0] });
    expect(tech2?.techNumber).toBe(2);
    expect(tech2?.body).toBe("Ronny - (816) 536-4348 - Monday 12-2pm");
    // The defect: Tech 1 and Tech 2 looked identical.
    expect(tech1?.color.bubble).not.toBe(tech2?.color.bubble);
  });

  it("gives the same tech the same colour and cycles after the palette runs out", () => {
    expect(techNoteDisplay("Tech 3: A")?.color).toBe(techNoteDisplay("tech #3 - B")?.color);
    expect(techNoteDisplay(`Tech ${TECH_NOTE_COLORS.length + 1}: C`)?.color).toBe(TECH_NOTE_COLORS[0]);
  });

  it("leaves ordinary notes and mid-sentence mentions uncoloured", () => {
    expect(techNoteDisplay("Ronny confirmed, customer informed.")).toBeNull();
    expect(techNoteDisplay("Called Tech 2: no answer")).toBeNull();
    expect(techNoteDisplay("Tech 0: invalid")).toBeNull();
    expect(techNoteDisplay("")).toBeNull();
    expect(techNoteDisplay(null)).toBeNull();
  });
});
