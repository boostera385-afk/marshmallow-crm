import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Lead } from "@/types";
import CheckTemplateButton from "./CheckTemplateButton";

const state = vi.hoisted(() => ({ copy: vi.fn(), dbFrom: vi.fn(), toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: state.toastError } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.dbFrom } }));
vi.mock("@/lib/lead-copy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-copy")>()),
  copyTextToClipboard: state.copy,
}));

const lead = {
  id: "lead-1",
  tech_name: "Sam",
  service_type: "Plumbing",
  service_details: "Leaking sink",
  city: "Austin",
  state: "TX",
  customer_schedule_requirements: "tomorrow after 2pm",
  quote: "$250",
  scheduled_date: null,
  scheduled_time_start: null,
  scheduled_time_end: null,
} as unknown as Lead;

const rows = (data: Array<{ key: string; template: string }> | null, error: { message: string } | null = null) =>
  state.dbFrom.mockImplementation(() => ({ select: () => ({ in: async () => ({ data, error }) }) }));

function open() {
  render(<QueryClientProvider client={new QueryClient()}><CheckTemplateButton lead={lead} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Check Template/ }));
}

const preview = () => (screen.getByLabelText("Preview message") as HTMLTextAreaElement).value;

describe("CheckTemplateButton", () => {
  beforeEach(() => {
    state.copy.mockReset().mockResolvedValue(undefined);
    state.dbFrom.mockReset();
    state.toastError.mockReset();
  });

  it("copies the built-in check message when no template is saved", async () => {
    rows([]);
    open();
    await waitFor(() => expect(state.dbFrom).toHaveBeenCalledWith("message_templates"));
    expect(preview()).toContain("Hi Sam, How are you? I have a new customer looking for Plumbing");
    expect(preview()).toContain("Area: Austin TX");
    fireEvent.click(screen.getByRole("button", { name: /Copy to Clipboard/ }));
    await waitFor(() => expect(state.copy).toHaveBeenCalledWith(expect.stringContaining("QUOTE : $250")));
  });

  it("uses the admin-saved check template and the typed technician name", async () => {
    rows([{ key: "check_template", template: "Yo {tech_name}, {service} in {area}?" }]);
    open();
    await waitFor(() => expect(preview()).toBe("Yo Sam, Plumbing in Austin TX?"));
    fireEvent.change(screen.getByLabelText("Technician name"), { target: { value: "Jo" } });
    expect(preview()).toBe("Yo Jo, Plumbing in Austin TX?");
  });

  it("keeps the built-in message when the saved templates cannot be read", async () => {
    rows(null, { message: "relation does not exist" });
    open();
    await waitFor(() => expect(state.dbFrom).toHaveBeenCalled());
    expect(preview()).toContain("Schedule Requirement: tomorrow after 2pm");
  });

  it("reports a clipboard failure instead of claiming success", async () => {
    rows([]);
    state.copy.mockRejectedValue(new Error("denied"));
    open();
    fireEvent.click(screen.getByRole("button", { name: /Copy to Clipboard/ }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Could not copy the message"));
    expect(screen.queryByText("Copied!")).toBeNull();
  });
});
