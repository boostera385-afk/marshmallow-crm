import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Lead } from "@/types";
import CopyLeadButton from "./CopyLeadButton";

const state = vi.hoisted(() => ({ role: "processor" as string, writeText: vi.fn(), dbFrom: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "synthetic" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.dbFrom, rpc: state.dbFrom } }));

const quotedLead = {
  id: "lead-1",
  customer_name: "Synthetic Customer",
  customer_phone: "555-0100",
  address: "1 Test St",
  service_details: "Fix sink",
  scheduled_date: null,
  scheduled_time_start: null,
  scheduled_time_end: null,
  reference_name: null,
  terms: "quoted",
  labor_amount: 300,
  material_amount: 100,
  for_you_amount: 250,
  for_us_amount: 150,
  quote: null,
} as unknown as Lead;

function openAndCopy(lead: Lead) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><CopyLeadButton lead={lead} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Copy Technician Message/ }));
  fireEvent.click(screen.getByRole("button", { name: /Copy to Clipboard/ }));
  return String(state.writeText.mock.calls.at(-1)?.[0] ?? "");
}

describe("CopyLeadButton original wording by terms", () => {
  beforeEach(() => {
    state.writeText.mockReset();
    state.dbFrom.mockReset();
    Object.assign(navigator, { clipboard: { writeText: state.writeText } });
  });

  it("copies the original quoted wording", () => {
    state.role = "processor";
    const copied = openAndCopy(quotedLead);
    expect(copied).toContain("Customer is agreed to pay ($300) total labor\n($100) FOR MATERIALS\n\nFor you: $250 labor including material\nFor us: $150 from total labor\n\nJob Scheduled for: TBD");
  });

  it.each(["customer_service", "cs_admin", "opr", "admin"])("gives %s the same quoted message", (role) => {
    state.role = "processor";
    const expected = openAndCopy(quotedLead);
    cleanup();
    state.role = role;
    expect(openAndCopy(quotedLead)).toBe(expected);
    expect(expected).toContain("For you: $250 labor including material");
  });

  it("copies the original free estimate wording", () => {
    state.role = "admin";
    const copied = openAndCopy({ ...quotedLead, terms: "free_estimate" } as Lead);
    expect(copied).toContain("FREE ESTIMATE VISIT\n\nFREE ESTIMATE VISIT Scheduled for: TBD");
    expect(copied).not.toContain("agreed to pay");
  });

  it("uses the built-in messages when saved templates cannot be read", async () => {
    state.role = "admin";
    state.dbFrom.mockImplementation(() => ({
      select: () => ({ in: async () => ({ data: null, error: { message: "relation does not exist" } }) }),
    }));
    expect(openAndCopy(quotedLead)).toContain("Customer is agreed to pay ($300) total labor");
    await waitFor(() => expect(state.dbFrom).toHaveBeenCalledWith("message_templates"));
    fireEvent.click(screen.getByRole("button", { name: /Copy to Clipboard|Copied!/ }));
    expect(String(state.writeText.mock.calls.at(-1)?.[0])).toContain("Customer is agreed to pay ($300) total labor");
    cleanup();
    expect(openAndCopy({ ...quotedLead, terms: null } as Lead)).toContain("Job Scheduled for: Not scheduled");
  });

  it("uses the admin-saved template for the lead's terms, for every role", async () => {
    state.role = "customer_service";
    state.dbFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { key: "technician_message_quoted", template: "EDITED QUOTED {customer_name} ${labor_amount_or_zero}" },
            { key: "check_template", template: "not used here" },
          ],
          error: null,
        }),
      }),
    }));
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><CopyLeadButton lead={quotedLead} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Copy Technician Message/ }));
    await waitFor(() => expect(screen.getByDisplayValue("EDITED QUOTED Synthetic Customer $300")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Copy to Clipboard/ }));
    expect(state.writeText).toHaveBeenLastCalledWith("EDITED QUOTED Synthetic Customer $300");
    cleanup();
    // A lead with no terms still uses the (unsaved) built-in standard message.
    expect(openAndCopy({ ...quotedLead, terms: null } as Lead)).toContain("Job Scheduled for: Not scheduled");
  });
});
