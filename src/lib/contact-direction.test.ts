import { describe, expect, it } from "vitest";
import {
  contactType,
  describeFirstContact,
  isContactType,
  parseFirstContact,
  splitContactType,
  summarizeContactEvents,
} from "./contact-direction";

describe("contact-direction", () => {
  it("round-trips kind and direction", () => {
    expect(contactType("call", "in")).toBe("call_in");
    expect(splitContactType("msg_out")).toEqual({ kind: "msg", direction: "out" });
  });

  it("only accepts the four known types", () => {
    expect(isContactType("call_out")).toBe(true);
    expect(isContactType("call_sideways")).toBe(false);
    expect(isContactType(null)).toBe(false);
  });

  it("parses table rows and rejects malformed ones", () => {
    expect(parseFirstContact({ lead_id: "l1", contact: "msg_in", source: "auto", occurred_at: "2026-11-01T10:00:00Z" }))
      .toMatchObject({ lead_id: "l1", contact: "msg_in", source: "auto", occurred_at: "2026-11-01T10:00:00Z" });
    expect(parseFirstContact({ lead_id: "l1", contact: "bogus", source: "auto" })).toBeNull();
    expect(parseFirstContact({ lead_id: "l1", contact: "msg_in", source: "ai" })).toBeNull();
    expect(parseFirstContact(undefined)).toBeNull();
  });

  it("counts events per type", () => {
    const counts = summarizeContactEvents([
      { id: "1", lead_id: "l", kind: "call", direction: "in", occurred_at: "x" },
      { id: "2", lead_id: "l", kind: "msg", direction: "out", occurred_at: "x" },
      { id: "3", lead_id: "l", kind: "msg", direction: "out", occurred_at: "x" },
    ]);
    expect(counts).toEqual({ call_in: 1, call_out: 0, msg_in: 0, msg_out: 2 });
  });

  it("describes the first contact in plain words", () => {
    expect(describeFirstContact(null)).toBe("First contact: not recorded yet");
    expect(describeFirstContact({ lead_id: "l", contact: "call_out", source: "manual", occurred_at: null }))
      .toBe("First contact: Call Outgoing (set by hand)");
    expect(describeFirstContact({ lead_id: "l", contact: "msg_in", source: "auto", occurred_at: "x" }, "Nov 1"))
      .toBe("First contact: Msg Incoming (from Quo, Nov 1)");
  });
});
