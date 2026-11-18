import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import NoteThread from "./NoteThread";

const state = vi.hoisted(() => ({
  role: "processor" as AppRole,
  grant: false,
  updates: [] as { id: string; content: string }[],
  updateResult: { rows: 1, error: null as { message: string } | null },
  edited: null as null | { edited_by: string; edited_by_name: string; edited_at: string },
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "me" }, role: state.role,
  profile: { full_name: "Me", can_edit_processor_notes: state.grant },
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    let pending: { content: string } | null = null;
    const query = {
      select: () => {
        if (pending) {
          return Promise.resolve({
            data: state.updateResult.error ? null : Array.from({ length: state.updateResult.rows }, () => ({ id: "x" })),
            error: state.updateResult.error,
          });
        }
        return query;
      },
      in: () => Promise.resolve({ data: [], error: null }),
      update: (values: { content: string }) => { pending = values; return query; },
      eq: (key: string, value: string) => {
        if (pending && key === "id") state.updates.push({ id: value, content: pending.content });
        return query;
      },
      order: (_: string, __: unknown) => Promise.resolve({ data: [{
        id: "colleague-note", lead_id: "lead-1", user_id: "colleague", user_name: "Colleague",
        note_type: "processor", content: "Tech 1: colleague note", created_at: "2026-11-01T00:00:00Z",
        ...(state.edited ?? {}),
      }], error: null }),
    };
    return query;
  },
} }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget(), relayTableToBus: () => () => {} }));

beforeEach(() => {
  state.role = "processor";
  state.grant = false;
  state.updates = [];
  state.updateResult = { rows: 1, error: null };
  state.edited = null;
  toastError.mockClear();
});
afterEach(() => cleanup());

async function renderThread() {
  render(<NoteThread leadId="lead-1" noteType="processor" label="Processor notes" />);
  await act(async () => { await Promise.resolve(); });
  await screen.findByText("Tech 1: colleague note");
}

describe("Edit Processor Notes grant", () => {
  it("hides the edit control on a colleague's processor note without the grant", async () => {
    await renderThread();
    expect(screen.queryByTitle("Edit note")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });

  it("lets a granted processor edit a colleague's processor note and saves only the content", async () => {
    state.grant = true;
    await renderThread();
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.change(screen.getByDisplayValue("Tech 1: colleague note"), { target: { value: "Tech 1: corrected" } });
    await act(async () => { fireEvent.click(screen.getByLabelText("Save note")); });
    expect(state.updates).toEqual([{ id: "colleague-note", content: "Tech 1: corrected" }]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reports a refused edit (RLS returns no rows) instead of treating it as saved", async () => {
    state.grant = true;
    state.updateResult = { rows: 0, error: null };
    await renderThread();
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.change(screen.getByDisplayValue("Tech 1: colleague note"), { target: { value: "Tech 1: corrected" } });
    await act(async () => { fireEvent.click(screen.getByLabelText("Save note")); });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to edit this note");
    // The editor stays open with the unsaved text.
    expect(screen.getByDisplayValue("Tech 1: corrected")).toBeInTheDocument();
  });

  it("reports a backend failure on save", async () => {
    state.grant = true;
    state.updateResult = { rows: 0, error: { message: "boom" } };
    await renderThread();
    fireEvent.click(screen.getByTitle("Edit"));
    await act(async () => { fireEvent.click(screen.getByLabelText("Save note")); });
    expect(toastError).toHaveBeenCalledWith("Failed to update note");
  });

  it("does not extend the grant to non-processor roles", async () => {
    state.role = "customer_service";
    state.grant = true;
    render(<NoteThread leadId="lead-1" noteType="processor" label="Processor notes" />);
    await act(async () => { await Promise.resolve(); });
    // CS cannot even view the processor thread.
    expect(screen.queryByText("Processor notes")).toBeNull();
  });

  it("shows which processor last edited a note", async () => {
    state.edited = { edited_by: "editor-2", edited_by_name: "Processor Two", edited_at: "2026-11-16T10:00:00Z" };
    await renderThread();
    expect(screen.getByText(/Edited by Processor Two/)).toBeInTheDocument();
  });

  it("shows no edited label on a note nobody edited", async () => {
    await renderThread();
    expect(screen.queryByText(/Edited by/)).toBeNull();
  });
});
