import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import { realtimeBus } from "@/lib/realtime";
import NoteThread from "./NoteThread";

const state = vi.hoisted(() => ({
  role: "customer_service" as AppRole,
  reads: [] as { lead: string; type: string }[],
  content: "Initial synthetic note",
  fail: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "synthetic-user" }, role: state.role, profile: { full_name: "Synthetic" },
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    const filters = { lead: "", type: "" };
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        if (key === "lead_id") filters.lead = value;
        if (key === "note_type") filters.type = value;
        return query;
      },
      order: () => {
        state.reads.push(filters);
        return Promise.resolve({ data: state.fail ? null : [{
          id: "synthetic-note", lead_id: filters.lead, user_id: null, user_name: "Synthetic",
          note_type: filters.type, content: state.content, created_at: "2026-10-14T00:00:00Z",
        }], error: state.fail ? { message: "Offline" } : null });
      },
    };
    return query;
  },
} }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget() }));

function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  fireEvent(document, new Event("visibilitychange"));
}
beforeEach(() => {
  vi.useFakeTimers();
  state.role = "customer_service";
  state.reads = [];
  state.content = "Initial synthetic note";
  state.fail = false;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("note polling request optimization", () => {
  it("pauses hidden polling, immediately catches up on return and keeps the 15-second visible cadence", async () => {
    render(<NoteThread leadId="lead-1" noteType="cs" label="CS notes" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("Initial synthetic note")).toBeInTheDocument();
    expect(state.reads).toHaveLength(1);
    visibility("hidden");
    state.content = "Updated while hidden";
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(state.reads).toHaveLength(1);
    await act(async () => { visibility("visible"); });
    expect(screen.getByText("Updated while hidden")).toBeInTheDocument();
    expect(state.reads).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(state.reads).toHaveLength(3);
    expect(state.reads.every((read) => read.lead === "lead-1" && read.type === "cs")).toBe(true);
  });

  it("retains draft text and note data across a failed catch-up, then recovers on the next poll", async () => {
    render(<NoteThread leadId="lead-1" noteType="cs" label="CS notes" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.change(screen.getByPlaceholderText("Add a note..."), { target: { value: "Unsaved draft" } });
    visibility("hidden");
    state.fail = true;
    await act(async () => { visibility("visible"); });
    expect(screen.getByText("Initial synthetic note")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a note...")).toHaveValue("Unsaved draft");
    state.fail = false;
    state.content = "Recovered note";
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("Recovered note")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a note...")).toHaveValue("Unsaved draft");
  });

  it("still refreshes matching realtime events without fetching another lead or note type", async () => {
    render(<NoteThread leadId="lead-1" noteType="cs" label="CS notes" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const send = (lead: string, type: string) => realtimeBus.dispatchEvent(new CustomEvent("lead_notes", {
      detail: { new: { lead_id: lead, note_type: type }, old: {} },
    }));
    await act(async () => { send("outside-scope", "cs"); send("lead-1", "processor"); });
    expect(state.reads).toHaveLength(1);
    state.content = "Realtime synthetic note";
    await act(async () => { send("lead-1", "cs"); });
    expect(state.reads).toHaveLength(2);
    expect(screen.getByText("Realtime synthetic note")).toBeInTheDocument();
  });

  it("does not poll an excluded thread and cleans up polling and catch-up listeners on unmount", async () => {
    const excluded = render(<NoteThread leadId="lead-1" noteType="processor" label="Processor notes" />);
    await act(async () => { visibility("visible"); await vi.advanceTimersByTimeAsync(60_000); });
    expect(state.reads).toHaveLength(0);
    expect(screen.queryByText("Processor notes")).toBeNull();
    excluded.unmount();
    const visible = render(<NoteThread leadId="lead-1" noteType="cs" label="CS notes" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const count = state.reads.length;
    visible.unmount();
    await act(async () => { visibility("visible"); await vi.advanceTimersByTimeAsync(60_000); });
    expect(state.reads).toHaveLength(count);
  });
});
