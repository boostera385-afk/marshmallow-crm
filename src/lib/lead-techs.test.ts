import { describe, expect, it } from "vitest";
import {
  buildTechEntry,
  countTechs,
  findTechNumbers,
  formatTechCount,
  nextTechNumber,
} from "@/lib/lead-techs";

const TECH_ONE = "Tech 1: Alex - (305) 555-0100 - he is available";
const TECH_TWO = "Tech 2: Sam - (305) 555-0111 - call after 3pm";

describe("finding techs in note text", () => {
  it("reads the numbers out of a note", () => {
    expect(findTechNumbers(`${TECH_ONE}\n\n${TECH_TWO}`)).toEqual([1, 2]);
  });

  it("tolerates the spacing and casing people actually type", () => {
    expect(findTechNumbers("  tech 4: Jo")).toEqual([4]);
    expect(findTechNumbers("TECH#7 - Kim")).toEqual([7]);
  });

  it("still reads entries written in the older heading-only shape", () => {
    expect(findTechNumbers("Tech 4\nName: Jo\nNumber: 555-0100")).toEqual([4]);
  });

  it("ignores prose that merely mentions a tech", () => {
    expect(findTechNumbers("Called the tech 2 times, no answer")).toEqual([]);
    expect(findTechNumbers("tech arriving soon")).toEqual([]);
  });

  it("handles empty input", () => {
    expect(findTechNumbers(null)).toEqual([]);
    expect(findTechNumbers(undefined)).toEqual([]);
    expect(findTechNumbers("")).toEqual([]);
  });
});

describe("counting techs across a thread", () => {
  it("adds up entries from separate notes", () => {
    expect(countTechs([TECH_ONE, TECH_TWO])).toBe(2);
  });

  it("counts several entries inside one note", () => {
    expect(countTechs([`${TECH_ONE}\n${TECH_TWO}`])).toBe(2);
  });

  it("is zero for a thread with no techs", () => {
    expect(countTechs(["Customer called back", null])).toBe(0);
  });
});

describe("numbering the next tech", () => {
  it("starts at 1 on an empty thread", () => {
    expect(nextTechNumber([])).toBe(1);
    expect(nextTechNumber(["No techs here"])).toBe(1);
  });

  it("continues past the highest number used", () => {
    expect(nextTechNumber([TECH_ONE, TECH_TWO])).toBe(3);
  });

  it("does not reuse a number when an earlier tech was deleted", () => {
    // Tech 2 removed, Tech 3 still on screen — the next one must be 4, not 3.
    expect(nextTechNumber(["Tech 1: Alex", "Tech 3: Rae"])).toBe(4);
  });
});

describe("formatTechCount", () => {
  it("uses the singular for one", () => {
    expect(formatTechCount(1)).toBe("1 tech");
  });

  it("uses the plural otherwise", () => {
    expect(formatTechCount(0)).toBe("0 techs");
    expect(formatTechCount(4)).toBe("4 techs");
  });
});

describe("writing a tech entry", () => {
  it("writes name, number and note as one readable line", () => {
    expect(
      buildTechEntry(1, { name: "John", phone: "(305) 555-0123", note: "he is available" }),
    ).toBe("Tech 1: John - (305) 555-0123 - he is available");
  });

  it("drops an empty note rather than leaving a dangling dash", () => {
    expect(buildTechEntry(2, { name: "John", phone: "(305) 555-0123" })).toBe(
      "Tech 2: John - (305) 555-0123",
    );
  });

  it("drops an empty number too", () => {
    expect(buildTechEntry(3, { name: "John", note: "no number yet" })).toBe(
      "Tech 3: John - no number yet",
    );
    expect(buildTechEntry(4, { name: "John" })).toBe("Tech 4: John");
  });

  it("trims what was typed", () => {
    expect(buildTechEntry(5, { name: "  John  ", phone: " (305) 555-0123 ", note: " ok " })).toBe(
      "Tech 5: John - (305) 555-0123 - ok",
    );
  });

  it("produces entries the counter reads back", () => {
    const first = buildTechEntry(1, { name: "John", phone: "(305) 555-0123" });
    const second = buildTechEntry(nextTechNumber([first]), { name: "Rae" });

    expect(second.startsWith("Tech 2:")).toBe(true);
    expect(countTechs([first, second])).toBe(2);
    expect(nextTechNumber([first, second])).toBe(3);
  });
});

describe("buildTechEntry contact word", () => {
  it("writes Texted / Called right after the number, where the database reads it", () => {
    expect(buildTechEntry(3, { name: "Ana", phone: "(305) 555-0144", contact: "Texted", note: "asked $400" })).toBe(
      "Tech 3: Ana - (305) 555-0144 - Texted - asked $400",
    );
    expect(buildTechEntry(4, { name: "Bo", contact: "Not texted" })).toBe("Tech 4: Bo - Not texted");
    expect(buildTechEntry(5, { name: "Cy", contact: null })).toBe("Tech 5: Cy");
  });
});
