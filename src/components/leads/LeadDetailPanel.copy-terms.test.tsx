import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/types";

/**
 * The drawer's Copy Technician Message follows the Quote Terms selected in the
 * form, before saving, the same way the lead page does (2026-11-16).
 */
const state = vi.hoisted(() => ({
  lead: {} as Record<string, unknown>,
  copied: [] as Lead[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const proxy: unknown = new Proxy(function noop() {}, {
      get(_target, prop) {
        if (prop === "then") {
          const data = table === "leads" ? state.lead : null;
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: 0 }).then(resolve);
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  const channel = () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => Promise.resolve() }; return ch; };
  return { supabase: { from: builder, rpc: () => builder("rpc"), channel, removeChannel: () => Promise.resolve(),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) } } };
});
vi.mock("@/contexts/AuthContext", () => {
  const user = { id: "admin-1", email: "admin@example.test" };
  return { useAuth: () => ({ user, role: "admin", profile: { full_name: "Synthetic Admin" }, canAccess: () => true }) };
});
vi.mock("@/hooks/useDuplicatePhoneCheck", () => ({ useDuplicatePhoneCheck: () => ({ isDuplicate: false, duplicateLeadName: null, checking: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("./CopyLeadButton", () => ({
  default: ({ lead }: { lead: Lead }) => { state.copied.push(lead); return <span data-testid="copy-terms">{lead.terms ?? "none"}</span>; },
}));
const Null = () => null;
for (const path of [
  "./QuoPhoneTrigger", "./NoteThread", "./CheckTemplateButton", "./CompleteLeadCopyButton", "./CxUpdateRequestButton",
  "./TechUpdateRequestButton", "./PaymentDialog", "./CancellationRequestSheet", "./CancellationRequestPanel",
  "./UrgentAICheckDialog", "./LeadCoverageBadge", "./MultiDateTimePicker", "./NumberNameCombobox", "./NearbyAreasList",
  "./LeadUpdatesSection", "./LeadStatusHistoryDialog", "./AssignLeadToOperatorDialog",
]) vi.doMock(path, () => ({ default: Null }));
vi.mock("@/components/service-combobox", () => ({ ServiceCombobox: () => null }));

const { default: LeadDetailPanel } = await import("./LeadDetailPanel");

const baseLead = {
  id: "lead-1", job_id: "LD-SYN1", status: "needs_quote", customer_name: "Synthetic Customer", customer_phone: "5550100000",
  service_type: "Plumbing", address: "1 Test St", created_by: "admin-1",
  terms: "quoted", labor_amount: 200, material_amount: 50, for_you_amount: 120, for_us_amount: 80,
};

beforeEach(() => { state.lead = { ...baseLead }; state.copied = []; });
afterEach(cleanup);

const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><LeadDetailPanel leadId="lead-1" onClose={() => {}} onUpdate={() => {}} /></MemoryRouter></QueryClientProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

describe("drawer Copy Technician Message follows the selected terms", () => {
  it("switches to Free Estimate as soon as it is selected, keeping For You / For Us and dropping charges", async () => {
    await mount();
    expect(screen.getByTestId("copy-terms")).toHaveTextContent("quoted");
    fireEvent.click(screen.getByRole("combobox", { name: "Quote Terms" }));
    fireEvent.click(screen.getByRole("option", { name: "Free Estimate Visit" }));
    expect(screen.getByTestId("copy-terms")).toHaveTextContent("free_estimate");
    expect(state.copied.at(-1)).toMatchObject({ terms: "free_estimate", labor_amount: null, material_amount: null, for_you_amount: 120, for_us_amount: 80 });
  });

  it("switches to Diagnostic/Service Call and uses the fee typed in the form", async () => {
    await mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Quote Terms" }));
    fireEvent.click(screen.getByRole("option", { name: "Diagnostic/Service Call" }));
    fireEvent.change(screen.getByLabelText("Diagnostic/Service Call Fee ($)"), { target: { value: "89" } });
    expect(state.copied.at(-1)).toMatchObject({ terms: "diagnostic_service_call", labor_amount: 89, material_amount: null });
  });
});
