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
const ROWS: DepartmentBreakdownRow[] = [
  { department: "ND", status: "paid", lead_count: 4 },
  { department: "ND", status: "cancelled", lead_count: 2 },
  { department: "ND", status: "waiting_customer_response", lead_count: 14 },
  { department: "FB", status: "paid", lead_count: 3 },
  { department: "FB", status: "quote_sent_waiting", lead_count: 7 },
  { department: "SEO", status: "scheduled", lead_count: 3 },
  { department: "Other", status: "cancelled", lead_count: 1 },
  { department: "not_in_jellybean", status: "paid", lead_count: 6 },
  { department: "not_in_jellybean", status: "cancelled", lead_count: 4 },
];

describe("LeadDepartmentReport", () => {
  beforeEach(() => { mocks.role = "admin"; mocks.rpc.mockReset(); });

  it("leads with how many leads came from JellyBean, then one card per department", async () => {
    respond({ data: ROWS });
    renderReport();
    expect(await screen.findByText(/of 44 leads \(77%\) came from JellyBean/)).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByLabelText("Nextdoor (ND): 20 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("Facebook (FB): 10 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("SEO: 3 leads")).toBeInTheDocument();
    expect(screen.getByLabelText("Not from JellyBean: 10 leads")).toBeInTheDocument();
    // One stray "Other" lead stays in the totals but gets no card of its own.
    expect(screen.queryByLabelText("Other JellyBean: 1 leads")).not.toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("get_lead_department_breakdown", {
      p_start: "2026-10-01T00:00:00.000Z", p_end: "2026-10-31T23:59:59.000Z",
    });
  });

  it("compares departments by stage and marks the best paid rate", async () => {
    respond({ data: ROWS });
    renderReport();
    const ndRow = await screen.findByRole("row", { name: /^Nextdoor \(ND\)/ });
    // Department, Leads, Waiting, Quoting, Booked, Job done, Paid, Cancelled, Paid rate
    expect(within(ndRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["20", "1470%", "00%", "00%", "00%", "420%", "210%", "20%"]);
    expect(within(screen.getByRole("row", { name: /^Other JellyBean/ })).getAllByRole("cell")[0]).toHaveTextContent("1");
    // FB 3/10 = 30%, ND 4/20 = 20%, Not from JellyBean 6/10 = 60% (SEO has under 10 leads).
    expect(screen.getAllByText("Best paid rate")).toHaveLength(1);
    expect(within(screen.getByLabelText("Not from JellyBean: 10 leads").closest("div.rounded-2xl") as HTMLElement).getByText("Best paid rate")).toBeInTheDocument();
  });

  it("shows every status for the department picked", async () => {
    respond({ data: ROWS });
    renderReport();
    const list = await screen.findByLabelText("Nextdoor (ND) leads by status");
    expect(within(list).getByText("Waiting Customer Response")).toBeInTheDocument();
    expect(within(list).queryByText("Quote Sent - Waiting")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Facebook \(FB\)/ }));
    const fb = screen.getByLabelText("Facebook (FB) leads by status");
    expect(within(fb).getByText("Quote Sent - Waiting")).toBeInTheDocument();
    expect(within(fb).getByText("7")).toBeInTheDocument();
  });

  it("tells the admin when new leads are still being checked against JellyBean", async () => {
    respond({ data: [...ROWS, { department: "pending", status: "waiting_customer_response", lead_count: 2 }] });
    renderReport();
    expect(await screen.findByText(/2 new leads are still being checked/)).toBeInTheDocument();
    expect(screen.getByText(/of 46 leads/)).toBeInTheDocument();
  });

  it("renders nothing and makes no request for a non-admin", () => {
    mocks.role = "cs_admin";
    respond({ data: [] });
    const { container } = renderReport();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("shows a server refusal or failure with a working retry, never empty numbers", async () => {
    respond({ error: { message: "Only Admins can view the department report" } }, { data: ROWS });
    renderReport();
    expect(await screen.findByText("Could not load the department report")).toBeInTheDocument();
    expect(screen.getByText("Only Admins can view the department report")).toBeInTheDocument();
    expect(screen.queryByText(/came from JellyBean/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Facebook (FB): 10 leads")).toBeInTheDocument();
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
