import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import NoteThread from "./NoteThread";

const state = vi.hoisted(() => ({
  role: "processor" as AppRole,
  reactions: [] as { user_id: string }[],
  noteAuthor: "colleague",
  inserts: [] as object[],
  deletes: [] as string[][],
  writeError: null as null | { message: string; code?: string },
  embedFails: false,
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "me" }, role: state.role, profile: { full_name: "Me" },
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    if (table === "lead_note_reactions") {
      return {
        insert: (v: object) => { state.inserts.push(v); return Promise.resolve({ error: state.writeError }); },
        delete: () => {
          const args: string[] = [];
          const q = { eq: (_c: string, v: string) => { args.push(v); if (args.length === 2) { state.deletes.push(args); return Promise.resolve({ error: state.writeError }); } return q; } };
          return q;
        },
      };
    }
    let embed = false;
    const query = {
      select: (cols: string) => { embed = cols.includes("lead_note_reactions"); return query; },
      in: () => Promise.resolve({ data: [], error: null }),
      eq: () => query,
      order: () => Promise.resolve(embed && state.embedFails
        ? { data: null, error: { message: "relation does not exist" } }
        : { data: [{
            id: "n1", lead_id: "lead-1", user_id: state.noteAuthor, user_name: "Colleague",
            note_type: "processor", content: "Tech 1: colleague note", created_at: "2026-11-01T00:00:00Z",
            ...(embed ? { lead_note_reactions: state.reactions } : {}),
          }], error: null }),
    };
    return query;
  },
} }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget() }));

beforeEach(() => {
  Object.assign(state, { role: "processor", reactions: [], noteAuthor: "colleague", inserts: [], deletes: [], writeError: null, embedFails: false });
  toastError.mockClear();
});
afterEach(() => cleanup());

async function renderThread() {
  render(<NoteThread leadId="lead-1" noteType="processor" label="Processor notes" />);
  await act(async () => { await Promise.resolve(); });
  await screen.findByText("Tech 1: colleague note");
}

describe("Processor note thumbs-up", () => {
  it("adds one thumbs-up to a colleague's note and shows the count", async () => {
    await renderThread();
    await act(async () => { fireEvent.click(screen.getByLabelText("Give a thumbs up")); });
    expect(state.inserts).toEqual([{ note_id: "n1", user_id: "me" }]);
    expect(screen.getByLabelText("Remove your thumbs up")).toHaveTextContent("1");
  });

  it("removes my thumbs-up when pressed again", async () => {
    state.reactions = [{ user_id: "me" }];
    await renderThread();
    await act(async () => { fireEvent.click(screen.getByLabelText("Remove your thumbs up")); });
    expect(state.deletes).toEqual([["n1", "me"]]);
    expect(state.inserts).toEqual([]);
    expect(screen.getByLabelText("Give a thumbs up")).toBeInTheDocument();
  });

  it("shows other processors' thumbs-up to everyone with the count", async () => {
    state.reactions = [{ user_id: "p2" }, { user_id: "p3" }];
    await renderThread();
    expect(screen.getByLabelText("Give a thumbs up")).toHaveTextContent("2");
  });

  it("rolls back and reports when the write is refused", async () => {
    state.writeError = { message: "denied", code: "42501" };
    await renderThread();
    await act(async () => { fireEvent.click(screen.getByLabelText("Give a thumbs up")); });
    expect(toastError).toHaveBeenCalled();
    expect(screen.getByLabelText("Give a thumbs up")).toHaveAttribute("aria-pressed", "false");
  });

  it("does not report a duplicate insert as a failure", async () => {
    state.writeError = { message: "duplicate", code: "23505" };
    await renderThread();
    await act(async () => { fireEvent.click(screen.getByLabelText("Give a thumbs up")); });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("offers no button on my own note but still shows its count", async () => {
    state.noteAuthor = "me";
    state.reactions = [{ user_id: "p2" }];
    await renderThread();
    expect(screen.queryByLabelText("Give a thumbs up")).toBeNull();
    expect(screen.getByText(/1 thumbs up/)).toBeInTheDocument();
  });

  it("keeps the thread readable when the reactions table is not available yet", async () => {
    state.embedFails = true;
    await renderThread();
    expect(screen.getByLabelText("Give a thumbs up")).toBeInTheDocument();
  });
});
