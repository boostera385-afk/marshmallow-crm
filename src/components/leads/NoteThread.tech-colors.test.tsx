import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import NoteThread from "./NoteThread";
import { TECH_NOTE_COLORS, personNoteColor } from "@/lib/tech-note-colors";

const state = vi.hoisted(() => ({ noteType: "processor" as string, role: "processor" as AppRole }));

// The tech tracking panel loads through TanStack Query and is tested on its own.
vi.mock("./TechTracking", () => ({ TechTrackingPanel: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "me" }, role: state.role, profile: { full_name: "Me" },
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    const note = (id: string, content: string, user_id = "me") => ({
      id, lead_id: "lead-1", user_id, user_name: "Processor9NOV", note_type: state.noteType,
      content, created_at: "2026-11-21T20:34:00Z", lead_note_reactions: [],
    });
    const query = {
      select: () => query,
      in: () => Promise.resolve({ data: [], error: null }),
      eq: () => query,
      order: () => Promise.resolve({ data: [
        note("n1", "Tech 1: Michael - (785) 816-5182 - texted"),
        note("n2", "Tech 2: Ronny - (816) 536-4348 - Monday 12-2pm", "colleague"),
        note("n3", "Ronny confirmed, customer informed."),
        note("n4", "She also asked for a text before arrival.", "colleague"),
        note("n5", "Confirmed $50 diagnostic on call.", "hamza"),
      ], error: null }),
    };
    return query;
  },
} }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget(), relayTableToBus: () => () => {} }));

afterEach(() => cleanup());

async function renderThread(noteType: "processor" | "cs") {
  state.noteType = noteType;
  state.role = noteType === "cs" ? "admin" : "processor";
  render(<NoteThread leadId="lead-1" noteType={noteType} label="Notes" />);
  await act(async () => { await Promise.resolve(); });
}

describe("Processor note tech colours", () => {
  it("draws each tech entry in its own colour with a Tech N chip, mine or not", async () => {
    await renderThread("processor");
    const tech1 = (await screen.findByText("Michael - (785) 816-5182 - texted")).closest("[data-tech-number]") as HTMLElement;
    const tech2 = screen.getByText("Ronny - (816) 536-4348 - Monday 12-2pm").closest("[data-tech-number]") as HTMLElement;

    expect(tech1).toHaveAttribute("data-tech-number", "1");
    expect(tech2).toHaveAttribute("data-tech-number", "2");
    expect(tech1.className).toContain(TECH_NOTE_COLORS[0].bubble);
    expect(tech2.className).toContain(TECH_NOTE_COLORS[1].bubble);
    // My own tech entry uses the tech colour, not the blue "my message" gradient.
    expect(tech1.className).not.toContain("bg-[linear-gradient");
    expect(screen.getByText("Tech 1")).toBeInTheDocument();
    expect(screen.getByText("Tech 2")).toBeInTheDocument();
  });

  it("keeps the normal bubble for notes that are not tech entries", async () => {
    await renderThread("processor");
    const plain = await screen.findByText("Ronny confirmed, customer informed.");
    expect(plain).not.toHaveAttribute("data-tech-number");
    expect(plain.className).toContain("bg-[linear-gradient");
  });

  it("colours CS notes Messenger style: mine blue, each other person one colour", async () => {
    await renderThread("cs");
    const mine = await screen.findByText("Tech 1: Michael - (785) 816-5182 - texted");
    const colleagueA = screen.getByText("Tech 2: Ronny - (816) 536-4348 - Monday 12-2pm");
    const colleagueB = screen.getByText("She also asked for a text before arrival.");
    const hamza = screen.getByText("Confirmed $50 diagnostic on call.");

    // CS notes are not tech entries: full text shown, no chip.
    expect(mine).not.toHaveAttribute("data-tech-number");
    expect(screen.queryByText("Tech 1", { exact: true })).toBeNull();
    // My notes keep the blue "mine" bubble.
    expect(mine).not.toHaveAttribute("data-note-color");
    expect(mine.className).toContain("bg-[linear-gradient");
    // The same colleague gets the same colour on every note, matching personNoteColor.
    expect(colleagueA.getAttribute("data-note-color")).toBe(colleagueB.getAttribute("data-note-color"));
    expect(colleagueA.className).toContain(personNoteColor("colleague").bubble);
    expect(hamza.className).toContain(personNoteColor("hamza").bubble);
    expect(colleagueA.className).not.toContain("bg-[linear-gradient");
  });

  it("leaves other threads (general) with the normal bubbles", async () => {
    state.noteType = "general";
    state.role = "admin";
    render(<NoteThread leadId="lead-1" noteType="general" label="Notes" />);
    await act(async () => { await Promise.resolve(); });
    const note = await screen.findByText("Ronny confirmed, customer informed.");
    expect(note).not.toHaveAttribute("data-note-color");
  });
});
