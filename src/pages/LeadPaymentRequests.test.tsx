import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeadPaymentRequests from "./LeadPaymentRequests";

const state = vi.hoisted(() => ({
  user: "admin-1", role: "admin", readError: false, leadError: false,
  rows: [] as Record<string, unknown>[], rpc: vi.fn(), reads: vi.fn(), success: vi.fn(), failure: vi.fn(),
  onEvent: null as (() => void) | null,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  role: state.role, user: { id: state.user }, profile: { full_name: "Admin" },
}) }));
vi.mock("@/lib/realtime", () => ({ subscribeToTableChanges: (_table: string, callback: () => void) => {
  state.onEvent = callback; return () => { state.onEvent = null; };
} }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.failure } }));
vi.mock("@/components/payments/InlineSuggestions", () => ({ InlineSuggestions: () => <div>Post-approval suggestions</div> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: state.rpc,
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, in: () => builder,
        then: (resolve: (value: unknown) => void) => {
          state.reads(table);
          resolve(table === "lead_payment_requests"
            ? { data: state.readError ? null : state.rows, error: state.readError ? new Error("Payment read failed") : null }
            : table === "leads"
              ? { data: [lead], error: state.leadError ? new Error("Lead read failed") : null }
              : { data: [], error: null });
        },
      };
      return builder;
    },
  },
}));
const ID = "00000000-0000-4000-8000-000000000001";
const lead = { id: ID, job_id: "MM-1", customer_name: "Synthetic Customer", status: "payment_requested" };
const row = { id: ID, lead_id: ID, previous_status: "job_done", requested_by: "processor-1",
  requested_by_role: "processor", request_type: "partial_paid", amount: 25, status: "pending" };
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LeadPaymentRequests /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.user = "admin-1"; state.role = "admin"; state.readError = false; state.leadError = false;
  state.rows = [{ ...row }]; state.onEvent = null;
  state.rpc.mockResolvedValue({ data: { saved: true, id: ID, status: "partial_paid" }, error: null });
});
afterEach(() => { cleanup(); client?.clear(); });

describe("Payment Approval Pending", () => {
  it("renders a yellow Partial Paid request badge and a green Paid request badge", async () => {
    state.rows.push({ ...row, id: "other", request_type: "paid" });
    mount();
    expect(await screen.findByText("Partial Paid request")).toHaveClass("bg-yellow-400/15");
    expect(screen.getByText("Paid request")).toHaveClass("bg-emerald-500/10");
    expect(screen.getByRole("button", { name: "Approve & mark partial paid" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve & mark paid" })).toBeVisible();
  });
  it("shows read errors and retries rather than advertising an empty queue", async () => {
    state.readError = true;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment read failed");
    expect(screen.queryByText("No pending payment requests.")).not.toBeInTheDocument();
    state.readError = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry payment requests" }));
    expect(await screen.findByText("Partial Paid request")).toBeVisible();
  });
  it("reports a failed required lead read independently", async () => {
    state.leadError = true;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment leads could not be loaded");
    expect(screen.queryByText("No pending payment requests.")).not.toBeInTheDocument();
  });
  it("never displays approved suggestions before acknowledgement, and blocks double review", async () => {
    let resolve!: (result: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mount();
    const approve = await screen.findByRole("button", { name: "Approve & mark partial paid" });
    fireEvent.click(approve); fireEvent.click(approve);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();
    expect(screen.queryByText("Post-approval suggestions")).not.toBeInTheDocument();
    state.rows = [];
    await act(async () => { resolve({ data: { saved: true, id: ID, status: "partial_paid" }, error: null }); });
    expect(await screen.findByText("Post-approval suggestions")).toBeVisible();
    expect(state.success).toHaveBeenCalledWith("Lead marked Partial Paid");
  });
  it("retains a failed review and its operation ID for safe retry without false success", async () => {
    state.rpc.mockResolvedValueOnce({ error: { message: "Review denied" }, data: null });
    mount();
    const approve = await screen.findByRole("button", { name: "Approve & mark partial paid" });
    fireEvent.click(approve);
    await waitFor(() => expect(state.failure).toHaveBeenCalledWith("Review denied"));
    expect(screen.queryByText("Post-approval suggestions")).not.toBeInTheDocument();
    expect(state.success).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await screen.findByText("Post-approval suggestions");
    expect(state.rpc.mock.calls[0]).toEqual(state.rpc.mock.calls[1]);
  });
  it("does no payment reads or subscriptions for an excluded role", async () => {
    state.role = "processor";
    mount();
    await act(async () => {});
    expect(state.reads).not.toHaveBeenCalled();
    expect(state.onEvent).toBeNull();
  });
  it("coalesces a realtime burst into one queue read and keeps the narrow batched lead projection", async () => {
    mount();
    await screen.findByText("Partial Paid request");
    state.reads.mockClear();
    await act(async () => { for (let i = 0; i < 50; i++) state.onEvent?.(); });
    await waitFor(() => expect(state.reads.mock.calls.filter(([table]) => table === "lead_payment_requests")).toHaveLength(1));
    expect(state.reads.mock.calls.filter(([table]) => table === "leads")).toHaveLength(1);
  });
  it("does not show a retired account's delayed approval after scope changes", async () => {
    let resolve!: (result: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Approve & mark partial paid" }));
    state.user = "admin-2";
    view.rerender(<QueryClientProvider client={client}><LeadPaymentRequests /></QueryClientProvider>);
    await act(async () => { resolve({ data: { saved: true, id: ID, status: "partial_paid" }, error: null }); });
    expect(screen.queryByText("Post-approval suggestions")).not.toBeInTheDocument();
    expect(state.success).not.toHaveBeenCalled();
  });
});
