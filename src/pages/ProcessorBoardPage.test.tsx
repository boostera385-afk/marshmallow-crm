import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob } from "@/lib/processor-board";
const state = vi.hoisted(() => ({ role: "processor", assess: vi.fn(), hook: vi.fn(), refetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "actor" }, role: state.role }) }));
vi.mock("@/hooks/useProcessorBoard", () => ({ PROCESSOR_QUERY_KEY: ["processor-board"], useProcessorBoard: state.hook }));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: null, address: "10 Sample St", city: "Miami", state: "FL", service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only", terms: "Quoted", status: "scheduled", updated_at: "2026-01-01T00:00:00Z", checked_at: null, assessment: null };
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); state.role = "processor";
  state.assess.mockResolvedValue({ result: {} });
  state.hook.mockReturnValue({ data: { rows: [job, { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "JOB-1002", customer_name: "Jane Example", status: "paid" }], total: 26, observed_at: "2026-10-15T18:00:00Z" }, isLoading: false, isFetching: false, isError: false, refetch: state.refetch });
});
afterEach(cleanup);
describe("Processor Board interactions", () => {
  it("uses the compact column layout and keeps the exact total separate from page counts", () => {
    mount();
    expect(screen.getAllByRole("columnheader").map((column) => column.textContent)).toEqual(["Customer / job / technician", "Service", "AI status", "Area", "Schedule", "Terms", "Action"]);
    expect(screen.getByLabelText("Total matching jobs")).toHaveTextContent("26");
    expect(screen.getByLabelText("Action counts on this page")).toHaveTextContent("On this page");
    expect(screen.getAllByText("Not checked yet").length).toBeGreaterThan(0);
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows the latest successful check above the job status on desktop, mobile and in the drawer", () => {
    const checkedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const reviewed = { ...job, checked_at: checkedAt, assessment: { status: "payment_pending", evidence: [], messages_reviewed: 1, matched_messages: 1, source: "Quo current history", history_complete: true, timezone: "America/New_York", checked_at: checkedAt, lead_updated_at: job.updated_at, summary: "Verified" } };
    state.hook.mockReturnValue({ data: { rows: [reviewed], total: 1, observed_at: new Date().toISOString() } });
    mount();
    const row = screen.getAllByRole("row")[1];
    const statusCell = within(row).getAllByRole("cell")[2];
    const check = within(statusCell).getByText("Checked 2m ago");
    const badge = within(statusCell).getByText("Payment Pending");
    expect(check.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(check).toHaveAttribute("datetime", checkedAt);
    expect(check.getAttribute("title")).toBeTruthy();
    expect(screen.getByLabelText("Latest AI check on this page")).toHaveTextContent("Checked 2m ago");
    expect(screen.getAllByText("Checked 2m ago")).toHaveLength(3);
    fireEvent.click(screen.getAllByLabelText("Review JOB-1001")[0]);
    expect(within(screen.getByRole("dialog")).getByText("Checked 2m ago")).toBeInTheDocument();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it.each(["expired", "changed record", "other timezone", "invalidated history"])("marks %s evidence as a previous check, not a fresh status", (reason) => {
    const checkedAt = new Date(Date.now() - (reason === "expired" ? 6 : 2) * 60_000).toISOString();
    const assessment = { status: "payment_pending", evidence: [], timezone: reason === "other timezone" ? "America/Chicago" : "America/New_York", checked_at: checkedAt, lead_updated_at: reason === "changed record" ? "2025-01-01T00:00:00Z" : job.updated_at };
    state.hook.mockReturnValue({ data: { rows: [{ ...job, checked_at: checkedAt, assessment: reason === "invalidated history" ? null : assessment }], total: 1, observed_at: new Date().toISOString() } });
    mount();
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[2];
    expect(cell).toHaveTextContent("Previous check");
    expect(cell).toHaveTextContent("Review stale · refresh AI");
    expect(within(cell).queryByText("Payment Pending")).not.toBeInTheDocument();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("does not label a failed retry as a fresh successful check", async () => {
    const checkedAt = new Date().toISOString();
    state.hook.mockReturnValue({ data: { rows: [{ ...job, checked_at: checkedAt, assessment: { status: "payment_pending", evidence: [], timezone: "America/New_York", checked_at: checkedAt, lead_updated_at: job.updated_at } }], total: 1, observed_at: checkedAt } });
    state.assess.mockRejectedValue(new Error("Synthetic provider unavailable")); mount();
    fireEvent.click(screen.getAllByLabelText("Review JOB-1001")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Synthetic provider unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[2];
    expect(cell).toHaveTextContent("Previous check just now");
    expect(cell).toHaveTextContent("Unavailable");
  });
  it("shows technician identity and schedule, and opens this job's evidence instead of another job", () => {
    mount(); expect(screen.getAllByText("4155550199").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    const dialog = screen.getByRole("dialog"); expect(dialog).toHaveTextContent("John Sample"); expect(dialog).not.toHaveTextContent("Jane Example");
    expect(dialog).toHaveTextContent("Afternoons only"); expect(dialog).toHaveTextContent("not a completed AI review");
  });
  it("retains the job and reports a failed review without fake completion", async () => {
    state.assess.mockRejectedValue(new Error("Synthetic provider unavailable")); mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Synthetic provider unavailable"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Saved lead status: Scheduled");
    expect(state.assess).toHaveBeenCalledExactlyOnceWith(job.id, "America/New_York");
  });
  it("bulk checks only eligible jobs and guards repeated clicks", async () => {
    let resolve!: () => void;
    state.assess.mockImplementation(() => new Promise((done) => { resolve = () => done({ result: {} }); })); mount();
    const button = screen.getByRole("button", { name: "Refresh AI · this page" });
    fireEvent.click(button); fireEvent.click(button);
    expect(state.assess).toHaveBeenCalledTimes(1); resolve();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No lead statuses or messages were changed"));
  });
  it("keeps failed-review page filters consistent with the displayed status counts", async () => {
    state.assess.mockRejectedValue(new Error("Synthetic provider unavailable")); mount();
    const actionCard = screen.getByRole("button", { name: /Take Job Update/ });
    fireEvent.click(actionCard);
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Synthetic provider unavailable"));
    expect(screen.queryAllByLabelText("Review JOB-1001")).toHaveLength(0);
    expect(actionCard).toHaveTextContent("0");
    expect(screen.getByRole("dialog")).toHaveTextContent("Unavailable");
  });
  it("searches with debounce, changes page on action, and exposes recovery on load failure", async () => {
    mount(); fireEvent.change(screen.getByRole("textbox", { name: "Search jobs or technicians" }), { target: { value: "John" } });
    await waitFor(() => expect(state.hook).toHaveBeenLastCalledWith(expect.objectContaining({ search: "John", offset: 0 })));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(state.hook).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }));
  });
  it("keeps incomplete jobs visible with a repair action and skips their AI requests", async () => {
    const incomplete = { ...job, id: "00000000-0000-4000-8000-000000000003", job_id: "JOB-MISSING", tech_number: null, scheduled_date: null };
    state.hook.mockReturnValue({ data: { rows: [incomplete, job], total: 2 }, refetch: state.refetch }); mount();
    expect(screen.getAllByText(/Save a valid technician number/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed · 0 failed · 1 skipped"));
    expect(state.assess).toHaveBeenCalledExactlyOnceWith(job.id, "America/New_York");
    fireEvent.change(screen.getByLabelText("Filter this page"), { target: { value: "setup" } });
    expect(screen.queryAllByLabelText("Review JOB-1001")).toHaveLength(0);
    fireEvent.click(screen.getAllByLabelText("Review JOB-MISSING")[0]);
    expect(screen.getByRole("button", { name: "Check this job" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /Open saved lead/ })).toHaveAttribute("href", `/leads/${incomplete.id}`);
  });
  it("retries failed jobs only, leaving successful jobs and setup problems untouched", async () => {
    const second = { ...job, id: "00000000-0000-4000-8000-000000000003", job_id: "JOB-1003" };
    state.hook.mockReturnValue({ data: { rows: [job, second], total: 2 }, refetch: state.refetch });
    state.assess.mockResolvedValueOnce({ result: {} }).mockRejectedValueOnce(new ProcessorReviewFailure("Synthetic Quo timeout")); mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed · 1 failed"));
    expect(screen.getAllByText("Synthetic Quo timeout").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry failed · 1" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed · 0 failed"));
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, second.id, second.id]);
    expect(screen.queryByRole("button", { name: /Retry failed/ })).not.toBeInTheDocument();
  });
  it("does not advertise a batch retry for errors needing configuration changes", async () => {
    state.assess.mockRejectedValue(new ProcessorReviewFailure("Verify saved technician chat", false, "chat_setup")); mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 failed"));
    expect(screen.queryByRole("button", { name: /Retry failed/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Verify saved technician chat").length).toBeGreaterThan(0);
  });
  it("skips fresh evidence during page refresh while permitting an explicit single-job recheck", async () => {
    const reviewed = { ...job, checked_at: new Date().toISOString(), assessment: { status: "payment_pending", evidence: [], timezone: "America/New_York", checked_at: new Date().toISOString(), lead_updated_at: job.updated_at } };
    state.hook.mockReturnValue({ data: { rows: [reviewed], total: 1 }, refetch: state.refetch }); mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("0 reviewed · 0 failed · 1 skipped"));
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByLabelText("Review JOB-1001")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(1));
  });
  it("stops after the in-flight job and does not start remaining requests", async () => {
    let finish!: () => void;
    state.assess.mockImplementation(() => new Promise((done) => { finish = () => done({ result: {} }); }));
    state.hook.mockReturnValue({ data: { rows: [job, { ...job, id: "second", job_id: "JOB-SECOND" }], total: 2 }, refetch: state.refetch }); mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "2");
    fireEvent.click(screen.getByRole("button", { name: "Stop after current job" })); finish();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 not started"));
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("retires a failure when the saved record changes, without losing the job", async () => {
    state.assess.mockRejectedValue(new Error("Old assignment failure")); const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getAllByText("Old assignment failure").length).toBeGreaterThan(0));
    state.hook.mockReturnValue({ data: { rows: [{ ...job, updated_at: "2026-10-15T19:00:00Z" }], total: 1 }, refetch: state.refetch });
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText("Old assignment failure")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Review JOB-1001")).toHaveLength(2);
  });
  it.each(["opr", "opr_admin", "customer_service", "cs_admin"])("does not read or show jobs to %s", (role) => {
    state.role = role; mount(); expect(screen.getByRole("alert")).toHaveTextContent("restricted"); expect(state.hook).not.toHaveBeenCalled();
  });
});
