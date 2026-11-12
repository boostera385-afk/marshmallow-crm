import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MessageTemplatesTab from "./MessageTemplatesTab";
import { BUILT_IN_TEMPLATES } from "@/lib/message-templates";

const state = vi.hoisted(() => ({
  dbFrom: vi.fn(),
  upsert: vi.fn(),
  deleteEq: vi.fn(),
  select: vi.fn(),
  log: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/lib/activity", () => ({ logActivity: state.log }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.dbFrom } }));

function renderTab() {
  render(<QueryClientProvider client={new QueryClient()}><MessageTemplatesTab /></QueryClientProvider>);
}

describe("Settings > Templates", () => {
  beforeEach(() => {
    for (const fn of [state.dbFrom, state.upsert, state.deleteEq, state.select, state.log, state.toast.success, state.toast.error]) fn.mockReset();
    state.select.mockResolvedValue({ data: [{ key: "technician_message_quoted", template: "Saved quoted" }], error: null });
    state.upsert.mockResolvedValue({ error: null });
    state.deleteEq.mockResolvedValue({ error: null });
    state.log.mockResolvedValue(undefined);
    state.dbFrom.mockImplementation(() => ({
      select: () => ({ in: state.select }),
      upsert: state.upsert,
      delete: () => ({ eq: state.deleteEq }),
    }));
  });

  it("shows saved and built-in texts, including the Check Template", async () => {
    renderTab();
    await waitFor(() => expect((screen.getByLabelText("Technician Message: Quoted") as HTMLTextAreaElement).value).toBe("Saved quoted"));
    expect((screen.getByLabelText("Check Template") as HTMLTextAreaElement).value).toBe(BUILT_IN_TEMPLATES.check_template);
    expect((screen.getByLabelText("Technician Message") as HTMLTextAreaElement).value).toBe(BUILT_IN_TEMPLATES.technician_message);
  });

  it("saves an edited template, re-reads it and audits the change", async () => {
    renderTab();
    const box = await screen.findByLabelText("Check Template");
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "Hi {tech_name}!" } });
    const card = box.closest("div.space-y-3") as HTMLElement;
    fireEvent.click(card.querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(state.upsert).toHaveBeenCalledWith({ key: "check_template", template: "Hi {tech_name}!" }));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Template saved"));
    expect(state.select).toHaveBeenCalledTimes(2);
    expect(state.log).toHaveBeenCalledWith("admin-1", "updated", "message_template", "check_template", expect.objectContaining({
      changes: { template: { before: BUILT_IN_TEMPLATES.check_template, after: "Hi {tech_name}!" } },
    }));
  });

  it("resets a saved template by deleting its row", async () => {
    renderTab();
    const box = await screen.findByLabelText("Technician Message: Quoted");
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe("Saved quoted"));
    const card = box.closest("div.space-y-3") as HTMLElement;
    fireEvent.click(Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Reset to built-in") as HTMLElement);
    await waitFor(() => expect(state.deleteEq).toHaveBeenCalledWith("key", "technician_message_quoted"));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Template reset to built-in"));
  });

  it("reports a rejected save and does not claim success", async () => {
    state.upsert.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    renderTab();
    const box = await screen.findByLabelText("Check Template");
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.click((box.closest("div.space-y-3") as HTMLElement).querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("new row violates row-level security policy"));
    expect(state.toast.success).not.toHaveBeenCalled();
    expect(state.log).not.toHaveBeenCalled();
  });

  it("a failed audit log after a successful save still reports the save", async () => {
    state.log.mockRejectedValue(new Error("log down"));
    renderTab();
    const box = await screen.findByLabelText("Check Template");
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "y" } });
    fireEvent.click((box.closest("div.space-y-3") as HTMLElement).querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Template saved"));
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it("disables editing and explains when saved templates cannot be loaded", async () => {
    state.select.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("relation does not exist");
    expect((screen.getByLabelText("Check Template") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
