import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepartmentBreakdownRow } from "@/lib/lead-department-analytics";
import { LeadDepartmentReport } from "./LeadDepartmentReport";

const mocks = vi.hoisted(() => ({ role: "admin", rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role, user: { id: "user-1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

function respond(...results: { data?: DepartmentBreakdownRow[]; error?: { message: string } }[]) {
  let call = 0;
  mocks.rpc.mockImplementation(() => ({
    abortSignal: vi.fn(() => {
      const result = results[Math.min(call++, results.length - 1)];
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    }),
  }));
}
const START = Date.parse("2026-10-01T00:00:00Z");
const END = Date.parse("2026-10-31T23:59:59Z");
function renderReport(props: Partial<{ startMs: number; endMs: number; rangeError: string | null }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LeadDepartmentReport startMs={props.startMs ?? START} endMs={props.endMs ?? END} rangeError={props.rangeError} /></QueryClientProvider>);
}

describe("LeadDepartmentReport", () => {
  beforeEach(() => { mocks.role = "admin"; mocks.rpc.mockReset(); });

  it("shows each department's total and the status breakdown for the selected range", async () => {
    respond({ data: [
      { department: "ND", status: "paid", lead_count: 4 },
      { department: "ND", status: "cancelled", lead_count: 1 },
      { department: "FB", status: "paid", lead_count: 2 },
      { department: "SEO", status: "scheduled", lead_count: 3 },
      { department: "not_in_jellybean", status: "paid", lead_count: 5 },
    ] });
    renderReport();
    expect(await screen.findByLabelText("Nextdoor (ND): 5 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("Facebook (FB): 2 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("SEO: 3 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("Not in JellyBean: 5 leads")).toBeInTheDocument();
    expect(screen.queryByText("Still checking")).not.toBeInTheDocument();
    expect(screen.getByText(/10 of 15 leads \(66\.7%\) were found in JellyBean/)).toBeInTheDocument();

    const paidRow = screen.getByRole("row", { name: /^Paid/ });
    // Status, ND, FB, SEO, Other, Not in JB, Checking, Total
    expect(within(paidRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Paid", "4", "2", "0", "0", "5", "0", "11"]);
    const totalRow = screen.getByRole("row", { name: /^All statuses/ });
    expect(within(totalRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["All statuses", "5", "2", "3", "0", "5", "0", "15"]);

    expect(mocks.rpc).toHaveBeenCalledWith("get_lead_department_breakdown", {
      p_start: "2026-10-01T00:00:00.000Z", p_end: "2026-10-31T23:59:59.000Z",
    });
  });

  it("tells the admin when new leads are still being checked against JellyBean", async () => {
    respond({ data: [{ department: "pending", status: "waiting_customer_response", lead_count: 2 }] });
    renderReport();
    expect(await screen.findByText(/2 leads are still being checked/)).toBeInTheDocument();
    expect(screen.getByLabelText("Still checking: 2 leads")).toBeInTheDocument();
  });

  it("renders nothing and makes no request for a non-admin", () => {
    mocks.role = "cs_admin";
    respond({ data: [] });
    const { container } = renderReport();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("shows a server refusal or failure with a working retry, never empty numbers", async () => {
    respond({ error: { message: "Only Admins can view the department report" } }, { data: [{ department: "FB", status: "paid", lead_count: 1 }] });
    renderReport();
    expect(await screen.findByText("Could not load the department report")).toBeInTheDocument();
    expect(screen.getByText("Only Admins can view the department report")).toBeInTheDocument();
    expect(screen.queryByText(/were found in JellyBean/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Facebook (FB): 1 leads")).toBeInTheDocument();
  });

  it("does not query for an invalid range", () => {
    respond({ data: [] });
    renderReport({ rangeError: "Start date must be on or before the end date." });
    expect(screen.getByRole("alert")).toHaveTextContent("Start date must be on or before the end date.");
    renderReport({ startMs: END, endMs: START });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("shows an empty state for a range with no leads", async () => {
    respond({ data: [] });
    renderReport();
    await waitFor(() => expect(screen.getByText("No leads in this period")).toBeInTheDocument());
  });
});
