import { describe, expect, it } from "vitest";
import { parseTechContact, summarizeTechs, type LeadTechContact } from "./tech-status";

let n = 0;
const tech = (over: Partial<LeadTechContact>): LeadTechContact => ({
  id: `t${++n}`, lead_id: "l1", tech_number: n, name: `Tech${n}`, phone: null, state: "not_texted",
  contacted_at: null, verdict: null, verdict_reason: null, evidence_quote: null, evidence_at: null,
  verdict_checked_at: null, ...over,
});

describe("summarizeTechs", () => {
  it("says No Tech Added when there are no techs", () => {
    expect(summarizeTechs([])).toMatchObject({ label: "No Tech Added", tone: "none" });
  });

  it("counts techs that are not texted yet", () => {
    expect(summarizeTechs([tech({}), tech({})]).label).toBe("2 techs, not texted");
    expect(summarizeTechs([tech({})]).label).toBe("1 tech, not texted");
  });

  it("names the techs who agreed, first names only", () => {
    const summary = summarizeTechs([
      tech({ name: "David Lee", tech_number: 2, state: "texted", verdict: "agreed" }),
      tech({ name: "Michael Ross", tech_number: 1, state: "called", verdict: "agreed" }),
      tech({ state: "texted", verdict: "declined" }),
    ]);
    expect(summary).toMatchObject({ label: "Michael, David agreed", tone: "agreed", agreed: 2 });
    expect(summarizeTechs([
      tech({ name: "A", state: "texted", verdict: "agreed" }),
      tech({ name: "B", state: "texted", verdict: "agreed" }),
      tech({ name: "C", state: "texted", verdict: "agreed" }),
    ]).label).toBe("A +2 agreed");
  });

  it("says No tech in area when every tech declined", () => {
    expect(summarizeTechs([
      tech({ state: "texted", verdict: "declined" }),
      tech({ state: "called", verdict: "declined" }),
    ])).toMatchObject({ label: "No tech in area", tone: "declined" });
  });

  it("prompts to text more when contacted techs declined but others are untouched", () => {
    expect(summarizeTechs([tech({ state: "texted", verdict: "declined" }), tech({})]).label).toBe("1 declined, text more");
  });

  it("counts techs still to answer", () => {
    expect(summarizeTechs([
      tech({ state: "texted", verdict: "pending" }),
      tech({ state: "texted", verdict: "unclear" }),
      tech({ state: "texted", verdict: "declined" }),
    ])).toMatchObject({ label: "Waiting on 2 techs", tone: "waiting" });
  });
});

describe("parseTechContact", () => {
  it("accepts table rows and rejects bad states", () => {
    expect(parseTechContact({ id: "1", lead_id: "l", tech_number: 1, name: "Sam", state: "texted", verdict: "agreed" }))
      .toMatchObject({ name: "Sam", state: "texted", verdict: "agreed" });
    expect(parseTechContact({ id: "1", lead_id: "l", tech_number: 1, state: "emailed" })).toBeNull();
    expect(parseTechContact({ id: "1", lead_id: "l", tech_number: 1, state: "texted", verdict: "maybe" })?.verdict).toBeNull();
  });
});
