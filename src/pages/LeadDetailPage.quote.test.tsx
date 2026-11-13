import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The customer quote split (Labor / Parts-Materials) is edited and saved by
 * every editing role on an existing lead — CS and CS Admin included — while the
 * internal For You/For Us technician split stays gated to non-CS roles.
 */
const state = vi.hoisted(() => ({
  role: "customer_service" as string,
  lead: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
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
  const user = { id: "cs-1", email: "cs@example.test" };
  return { useAuth: () => ({ user, role: state.role, profile: { full_name: "Synthetic CS" }, canAccess: () => true }) };
});
vi.mock("@/lib/lead-updates", () => ({
  NO_ROW_UPDATED_MESSAGE: "not applied",
  updateLeadById: vi.fn(async (_id: string, changes: Record<string, unknown>) => { state.updates.push(changes); }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/lead-address-geocoding", () => ({ geocodeAndPersistLeadAddress: vi.fn(async () => false) }));
vi.mock("@/hooks/useDuplicatePhoneCheck", () => ({ useDuplicatePhoneCheck: () => ({ isDuplicate: false, duplicateLeadName: null, checking: false }) }));
vi.mock("@/hooks/useNearbyUrgentLeads", () => ({ useNearbyUrgentLeads: () => [] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const Null = () => null;
for (const path of [
  "@/components/leads/QuoPhoneTrigger", "@/components/leads/NoteThread", "@/components/leads/NearbyUrgentLeads",
  "@/components/leads/LeadTagControl", "@/components/leads/CopyLeadButton", "@/components/leads/CheckTemplateButton",
  "@/components/leads/CompleteLeadCopyButton", "@/components/leads/CxUpdateRequestButton", "@/components/leads/TechUpdateRequestButton",
  "@/components/leads/ReminderButton", "@/components/leads/LeadPhotoActions", "@/components/leads/PaymentDialog",
  "@/components/leads/ImageLightbox", "@/components/leads/CancellationRequestSheet", "@/components/leads/CancellationRequestPanel",
  "@/components/leads/UrgentAICheckDialog", "@/components/leads/LeadCoverageBadge", "@/components/leads/MultiDateTimePicker",
  "@/components/leads/NumberNameCombobox", "@/components/leads/NearbyAreasList",
]) vi.doMock(path, () => ({ default: Null }));
vi.mock("@/components/service-combobox", () => ({ ServiceCombobox: () => null }));

const { default: LeadDetailPage } = await import("./LeadDetailPage");

const baseLead = {
  id: "lead-1", job_id: "LD-SYN1", status: "needs_quote", customer_name: "Synthetic Customer", customer_phone: "5550100000",
  number_name: "Main", service_type: "Plumbing", address: "1 Test St, Miami, FL 33101", latitude: 25.7, longitude: -80.2,
  created_by: "cs-1", terms: "quoted", labor_amount: 200, material_amount: 50, for_you_amount: 120, for_us_amount: 80,
};

const mount = async () => {
  render(<MemoryRouter initialEntries={["/leads/lead-1"]}><Routes><Route path="/leads/:id" element={<LeadDetailPage />} /></Routes></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const save = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save/i })); await new Promise((r) => setTimeout(r, 20)); });
};

beforeEach(() => { state.lead = { ...baseLead }; state.updates = []; });
afterEach(cleanup);

describe.each(["customer_service", "cs_admin"])("%s editing an existing lead's quote", (role) => {
  beforeEach(() => { state.role = role; });

  it("can edit the labor amount and the edit is saved", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Customer Labor ($)"), { target: { value: "300" } });
    await save();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ terms: "quoted", labor_amount: 300, material_amount: 50 });
  });

  it("choosing No for materials saves no materials charge at all", async () => {
    await mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Parts/Materials charges?" }));
    fireEvent.click(screen.getByRole("option", { name: "No" }));
    expect(screen.queryByLabelText("Parts/Materials ($)")).not.toBeInTheDocument();
    await save();
    expect(state.updates[0]).toMatchObject({ labor_amount: 200, material_amount: null });
  });

  it("still cannot change the internal For You/For Us split", async () => {
    await mount();
    await save();
    expect(state.updates[0]).toMatchObject({ for_you_amount: 120, for_us_amount: 80 });
  });
});

it("rejects Yes-materials with no amount instead of saving", async () => {
  state.role = "customer_service";
  await mount();
  fireEvent.change(screen.getByLabelText("Parts/Materials ($)"), { target: { value: "" } });
  await save();
  expect(state.updates).toHaveLength(0);
});
