import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lead: {} as Record<string, unknown>, role: "admin", rpc: vi.fn(), upload: vi.fn(), error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const proxy: unknown = new Proxy(function noop() {}, {
      get: (_target, property) => property === "then"
        ? (resolve: (value: unknown) => void) => resolve({ data: table === "leads" ? state.lead : null, error: null, count: 1 })
        : () => proxy,
    });
    return proxy;
  };
  const channel = () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; };
  return { supabase: { from: builder, rpc: state.rpc, channel, removeChannel: vi.fn(),
    storage: { from: () => ({ upload: state.upload, createSignedUrls: async () => ({ data: [], error: null }) }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  role: state.role, user: { id: "00000000-0000-4000-8000-000000000001" }, profile: { full_name: "Admin" }, canAccess: () => true,
}) }));
vi.mock("@/hooks/useDuplicatePhoneCheck", () => ({ useDuplicatePhoneCheck: () => ({ isDuplicate: false }) }));
vi.mock("@/lib/image-upload", () => ({ optimizeImageForUpload: async (file: File) => file }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: vi.fn(), info: vi.fn() } }));
const Null = () => null;
for (const path of [
  "./QuoPhoneTrigger", "./NoteThread", "./CopyLeadButton", "./CheckTemplateButton", "./CompleteLeadCopyButton",
  "./CxUpdateRequestButton", "./TechUpdateRequestButton", "./CancellationRequestSheet", "./CancellationRequestPanel",
  "./UrgentAICheckDialog", "./LeadCoverageBadge", "./MultiDateTimePicker", "./NumberNameCombobox", "./NearbyAreasList",
  "./LeadUpdatesSection", "./LeadStatusHistoryDialog", "./AssignLeadToOperatorDialog",
]) vi.doMock(path, () => ({ default: Null }));
// Named exports: the first-contact chip and contact history strip load through TanStack Query.
vi.doMock("./FirstContactControl", () => ({ FirstContactControl: Null, ContactHistoryStrip: Null, FirstContactCell: Null }));
vi.mock("@/components/service-combobox", () => ({ ServiceCombobox: Null }));
const { default: LeadDetailPanel } = await import("./LeadDetailPanel");
const ID = "00000000-0000-4000-8000-000000000002";
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); state.role = "admin";
  state.lead = { id: ID, job_id: "MM-1", status: "job_done", customer_name: "Synthetic", created_at: "2026-11-20" };
  state.rpc.mockResolvedValue({ data: { saved: true, id: ID, status: "partial_paid" }, error: null });
  state.upload.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); client?.clear(); });
async function mountAndChoosePaid() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter>
    <LeadDetailPanel leadId={ID} onClose={vi.fn()} onUpdate={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
  const status = (await screen.findAllByRole("combobox")).find((box) => /Job Done|Partial Paid/.test(box.textContent ?? ""));
  expect(status).toBeDefined();
  fireEvent.click(status!);
  fireEvent.click(screen.getByRole("option", { name: "Paid" }));
  return screen.findByRole("dialog", { name: "Paid Confirmation" });
}
describe("legacy drawer payment reliability", () => {
  it.each(["paid", "partial_paid"] as const)("saves the Admin's selected %s through the transaction", async (requestType) => {
    await mountAndChoosePaid();
    fireEvent.click(screen.getByRole("radio", { name: requestType === "paid" ? "Paid" : "Partial Paid" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "40" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: requestType === "paid" ? "Confirm Paid" : "Confirm Partial Paid" })); });
    expect(state.rpc).toHaveBeenCalledWith("workflow_requests", { p_input: expect.objectContaining({
      kind: "payment", action: "direct", requestType, amount: 40, leadId: ID,
    }) });
    expect(screen.queryByRole("dialog", { name: /Confirmation/ })).not.toBeInTheDocument();
  });
  it("retains amount and selected evidence after upload failure without submitting a payment", async () => {
    state.upload.mockResolvedValueOnce({ error: { message: "Denied" } });
    await mountAndChoosePaid();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Payment Screenshot"), { target: { files: [new File(["proof"], "proof.png")] } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm Paid" })); });
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining("screenshot upload failed")));
    expect(state.rpc).not.toHaveBeenCalledWith("workflow_requests", expect.objectContaining({ p_input: expect.objectContaining({ kind: "payment" }) }));
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
    expect(screen.getByRole("dialog", { name: "Paid Confirmation" })).toBeVisible();
  });
  it("offers both outcomes when the saved lead is already Partial Paid", async () => {
    state.lead.status = "partial_paid";
    await mountAndChoosePaid();
    expect(screen.getByRole("radio", { name: "Partial Paid" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Paid" })).toBeVisible();
  });
});
