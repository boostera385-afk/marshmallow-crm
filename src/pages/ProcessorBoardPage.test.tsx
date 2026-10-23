import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob } from "@/lib/processor-board";
const state = vi.hoisted(() => ({ role: "processor", canTechChat: true, chat: vi.fn(), assess: vi.fn(), hook: vi.fn(), refetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "actor" }, role: state.role, canAccess: () => state.canTechChat }) }));
vi.mock("@/lib/quo-chat", () => ({ fetchQuoChatThread: state.chat, sendQuoChatMessage: vi.fn() }));
vi.mock("@/hooks/useProcessorBoard", () => ({ PROCESSOR_QUERY_KEY: ["processor-board"], useProcessorBoard: state.hook }));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: null, address: "10 Sample St", city: "Miami", state: "FL", service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only", terms: "Quoted", status: "scheduled", updated_at: "2026-01-01T00:00:00Z", checked_at: null, assessment: null };
const reviewResult = () => ({ status: "take_job_update", evidence: [], messages_reviewed: 10, matched_messages: 1, source: "Quo current history", history_complete: true, ai_used: false, timezone: "America/New_York", lead_updated_at: job.updated_at, checked_at: new Date().toISOString(), summary: "No verified technician update" });
function mount() {
  const viewClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={viewClient}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>);
  const options = screen.queryByText("Filters & tracking", { exact: true });
  if (options) fireEvent.click(options);
  const confirm = screen.queryByLabelText("Confirm schedule timezone");
  if (confirm) fireEvent.click(confirm);
  return { ...view, client: viewClient };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks(); state.role = "processor"; state.canTechChat = true;
  state.chat.mockResolvedValue({ phoneNumber: { id: "PN12345678", number: "+17475887812", formattedNumber: "+17475887812", name: "Technician Communications" }, conversation: null, messages: [{ id: "stored", text: "Synthetic stored technician update", direction: "incoming", createdAt: "2026-10-22T15:00:00Z" }] });
  state.assess.mockResolvedValue({ result: reviewResult() });
  state.hook.mockReturnValue({ data: { rows: [job, { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "JOB-1002", customer_name: "Jane Example", status: "paid" }], total: 26, observed_at: "2026-10-15T18:00:00Z" }, isLoading: false, isFetching: false, isError: false, refetch: state.refetch });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Processor Board interactions", () => {
  it("keeps long diagnostics collapsed once while exposing the next action and job-only controls", async () => {
    const summary = "Synthetic long diagnostic history and filtering explanation.";
    const assessment = { ...reviewResult(), summary, matched_technician_messages: 0, context_technician_messages: 0 };
    state.hook.mockReturnValue({ data: { rows: [{ ...job, assessment, checked_at: assessment.checked_at }], total: 1 } });
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Check this job" })).toBeVisible());
    expect(within(dialog).getByText(summary)).not.toBeVisible();
    expect(within(dialog).getAllByText(summary)).toHaveLength(1);
    expect(dialog).toHaveTextContent("Ask the technician for this job's current update");
    expect(within(dialog).getByLabelText("Job review actions")).toContainElement(within(dialog).getByRole("button", { name: "Check this job" }));
    fireEvent.click(within(dialog).getByText("Check details & safety", { exact: true }));
    expect(within(dialog).getByText(summary)).toBeVisible();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it.each(["assignment", "chat"])("does not attach an in-flight old result after the %s changes", async (change) => {
    const setup = { state: "ready" as const, code: "ready", message: "Verified", fingerprint: "old-chat", conversation_id: "00000000-0000-4000-8000-000000000123", last_message_at: null, source: "verified_mirror" as const };
    const original = { ...job, chat_setup: setup };
    state.hook.mockReturnValue({ data: { rows: [original], total: 1 }, isFetching: false, refetch: state.refetch });
    let finish!: (response: { result: ReturnType<typeof reviewResult> & { chat_fingerprint: string } }) => void;
    state.assess.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = mount();
    const key = ["processor-board", "actor", "processor", { offset: 0, search: "", history: false, timezone: "America/New_York" }];
    view.client.setQueryData(key, { rows: [original], total: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    expect(state.assess).toHaveBeenCalledTimes(1);
    const changed = change === "assignment" ? { ...original, tech_number: "4155550188", updated_at: "2026-10-23T12:00:00Z" } : { ...original, chat_setup: { ...setup, fingerprint: "new-chat" } };
    view.client.setQueryData(key, { rows: [changed], total: 1 });
    finish({ result: { ...reviewResult(), chat_fingerprint: "old-chat" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    const cached = view.client.getQueryData<{ rows: ProcessorJob[] }>(key)!;
    expect(cached.rows[0].assessment).toBeNull();
    expect(cached.rows[0].tech_number).toBe(changed.tech_number);
    expect(cached.rows[0].chat_setup?.fingerprint).toBe(changed.chat_setup.fingerprint);
  });
  it("keeps supported previous completion visible with a stale label and its original quotes", () => {
    const checked_at = new Date(Date.now() - 10 * 60_000).toISOString();
    state.hook.mockReturnValue({ data: { rows: [{ ...job, checked_at, assessment: { ...reviewResult(), status: "payment_pending", checked_at, ai_used: true, evidence: [{ signal: "completed", message_id: "done", message_time: checked_at, sender: "customer", quote: "JOB-1001 is completed" }] } }], total: 1 } });
    mount();
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3];
    expect(cell).toHaveTextContent("Payment Pending");
    expect(cell).toHaveTextContent("Previous AI result · refresh due");
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("This is not a fresh check");
    expect(screen.getByRole("dialog")).toHaveTextContent("JOB-1001 is completed");
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows saved full and partial job addresses instead of falsely reporting missing area", () => {
    state.hook.mockReturnValue({ data: { rows: [{ ...job, city: null, state: null, address: "House 10, Sample Street" }, { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "JOB-1002", city: null, state: null, address: null, half_address: "House 12, Side Street" }], total: 2 } });
    mount();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[4]).toHaveTextContent("House 10, Sample Street");
    expect(within(rows[1]).getAllByRole("cell")[4]).toHaveTextContent("House 12, Side Street");
    expect(screen.queryByText("Job location missing")).not.toBeInTheDocument();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("keeps missing-chat remediation readable on the row without spending AI", () => {
    const message = "Chat not found — verify the technician number and saved conversation.";
    state.hook.mockReturnValue({ data: { rows: [{ ...job, chat_setup: { state: "blocked", code: "missing_chat_link", message, fingerprint: "blocked", conversation_id: null, last_message_at: null, source: null } }], total: 1 } });
    mount();
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3];
    expect(cell).toHaveTextContent("Needs Review");
    expect(within(cell).getByText(message)).not.toHaveClass("line-clamp-1");
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("opens as a compact job table with optional filters closed and technician identity in its own column", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>);
    const options = screen.getByText("Filters & tracking", { exact: true }).closest("details");
    expect(options).not.toHaveAttribute("open");
    expect(screen.getByRole("columnheader", { name: "Technician" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter this page")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Filters & tracking", { exact: true }));
    expect(options).toHaveAttribute("open", "");
    // motion.section animates opacity from 0; wait for the entrance to finish.
    await waitFor(() => expect(screen.getByLabelText("Filter this page")).toBeVisible());
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("unlocks AI controls after a completed review even while recovery list invalidation is pending", async () => {
    vi.spyOn(QueryClient.prototype, "invalidateQueries").mockImplementationOnce(() => new Promise(() => {}));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeEnabled();
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("opens the verified technician conversation inside CRM without AI, external navigation or a Quo login", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000123";
    state.hook.mockReturnValue({ data: { rows: [{ ...job, chat_setup: { state: "ready", conversation_id: conversationId, source: "verified_mirror", fingerprint: "saved-chat" } }], total: 1 } });
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    expect(state.chat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open technician chat in CRM" }));
    expect(await screen.findByText("Synthetic stored technician update")).toBeInTheDocument();
    expect(state.chat).toHaveBeenCalledExactlyOnceWith("+14155550199", "tech", conversationId);
    const chat = screen.getByRole("dialog", { name: "Tech Quick Chat: Alex" });
    expect(chat).toHaveTextContent("No Quo login is needed");
    expect(within(chat).queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open verified technician chat" })).toBeNull();
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
    expect(await screen.findByRole("button", { name: "Check this job" })).toBeInTheDocument();
  });
  it("does not bypass a missing chat grant", () => {
    state.canTechChat = false;
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    expect(screen.getByRole("button", { name: "Open technician chat in CRM" })).toBeDisabled();
    expect(screen.getByText(/Tech Quick Chat access is required/)).toBeInTheDocument();
    expect(state.chat).not.toHaveBeenCalled();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("does not guess an external chat when the verified CRM mirror is absent", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    expect(screen.getByRole("button", { name: "Open technician chat in CRM" })).toBeDisabled();
    expect(screen.getByText(/No verified CRM conversation is available/)).toBeInTheDocument();
    expect(state.chat).not.toHaveBeenCalled();
  });
  it.each(["technician", "conversation", "permission", "scope"])("retires an open CRM chat after a %s change", async (change) => {
    const conversationId = "00000000-0000-4000-8000-000000000123";
    const saved = { ...job, chat_setup: { state: "ready", conversation_id: conversationId, source: "verified_mirror", fingerprint: "saved-chat" } };
    state.hook.mockReturnValue({ data: { rows: [saved], total: 1 } });
    const view = mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Open technician chat in CRM" }));
    await screen.findByText("Synthetic stored technician update");
    if (change === "permission") state.canTechChat = false;
    const next = change === "technician" ? { ...saved, tech_number: "4155550123" } : change === "conversation" ? { ...saved, chat_setup: { ...saved.chat_setup, conversation_id: "00000000-0000-4000-8000-000000000124" } } : saved;
    state.hook.mockReturnValue({ data: { rows: change === "scope" ? [] : [next], total: 1 } });
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByRole("dialog", { name: "Tech Quick Chat: Alex" })).not.toBeInTheDocument();
    expect(state.chat).toHaveBeenCalledTimes(1);
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows exact check dates and distinguishes AI use from schedule rules without a request", () => {
    const checked_at = new Date().toISOString();
    const assessment = { status: "payment_pending", evidence: [{ signal: "completed", quote: "JOB-1001 completed" }], checked_at, timezone: "America/New_York", lead_updated_at: job.updated_at };
    state.hook.mockReturnValue({ data: { rows: [
      { ...job, checked_at, assessment: { ...assessment, ai_used: true } },
      { ...job, id: "second", job_id: "JOB-1002", checked_at, assessment: { ...assessment, status: "scheduled", evidence: [], ai_used: false } },
    ], total: 2, observed_at: checked_at } });
    mount();
    const cells = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[3]);
    expect(cells[0]).toHaveTextContent("AI evidence · technician completion verified");
    expect(cells[1]).toHaveTextContent("Schedule rule · no AI used");
    expect(within(cells[0]).getByLabelText("Last checked date and time")).toHaveTextContent(new Date(checked_at).getUTCFullYear().toString());
    expect(within(cells[0]).getByLabelText("Last checked date and time").textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows context-attributed replies, the saved Tech Quick Chat source and honest page counts", () => {
    const checkedAt = new Date().toISOString();
    state.hook.mockReturnValue({ data: { rows: [{ ...job, checked_at: checkedAt, assessment: { status: "job_in_progress", evidence: [{ signal: "progress", quote: "I am on my way to the property now", message_id: "m2", message_time: checkedAt, sender: "customer", identity_basis: "thread_context" }], messages_reviewed: 9, matched_messages: 3, matched_technician_messages: 0, context_technician_messages: 2, unattributed_technician_messages: 1, source: "Quo current history", history_complete: true, ai_used: true, timezone: "America/New_York", checked_at: checkedAt, lead_updated_at: job.updated_at, summary: "Context-attributed technician replies reviewed." } }], total: 1, observed_at: checkedAt } });
    mount();
    expect(screen.getByLabelText("Evidence quality on this page")).toHaveTextContent("1 with a technician reply tied to the job");
    expect(screen.getByLabelText("Evidence quality on this page")).toHaveTextContent("1 rely on this job's saved dispatch");
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3];
    expect(cell).toHaveTextContent("context-attributed · verify in Quo");
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-1001" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2 technician replies are tied to this job (2 via this job's saved dispatch)");
    expect(dialog).toHaveTextContent("this job's saved dispatch");
    expect(dialog).toHaveTextContent("Quo current history · saved Tech Quick Chat");
    expect(dialog).toHaveTextContent("Verify it in Quo before acting");
  });
  it("filters by saved status independently of AI actions and reviews approval evidence without changing the saved workflow", async () => {
    state.hook.mockReturnValue({ data: { rows: [job, { ...job, id: "reschedule", job_id: "JOB-RESCHEDULE", status: "needs_reschedule" }, { ...job, id: "approval", job_id: "JOB-APPROVAL", status: "cancellation_requested" }], total: 3 } });
    mount();
    fireEvent.change(screen.getByLabelText("Saved status on this page"), { target: { value: "needs_reschedule" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryAllByLabelText("Review JOB-1001")).toHaveLength(0);
    expect(screen.getAllByLabelText("Review JOB-RESCHEDULE")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Saved status on this page"), { target: { value: "cancellation_requested" } });
    fireEvent.click(screen.getAllByLabelText("Review JOB-APPROVAL")[0]);
    expect(screen.getByRole("button", { name: "Check this job" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Cancellation approval pending. AI evidence cannot approve or cancel this job.");
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check this job" })).toBeEnabled());
    expect(state.assess).toHaveBeenCalledExactlyOnceWith("approval", "America/New_York");
    expect(screen.getByRole("dialog")).toHaveTextContent("Saved lead status: Cancellation Pending");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 reviewed");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("defaults to five rows in view but keeps all matching jobs in the page-level AI review", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ ...job, id: `synthetic-${index}`, job_id: `JOB-${index}` }));
    state.hook.mockReturnValue({ data: { rows, total: 26, observed_at: new Date().toISOString() }, refetch: state.refetch });
    mount();
    expect(screen.getByLabelText("Rows in view")).toHaveValue("5");
    expect(screen.getAllByRole("row")).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("Rows in view"), { target: { value: "10" } });
    expect(screen.getByLabelText("Rows in view")).toHaveValue("10");
    expect(state.hook).toHaveBeenLastCalledWith({ offset: 0, search: "", history: false, timezone: "America/New_York" });
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Rows in view"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 reviewed"));
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual(rows.map(({ id }) => id));
  });
  it("uses the compact column layout and keeps the exact total separate from page counts", () => {
    mount();
    expect(screen.getAllByRole("columnheader").map((column) => column.textContent)).toEqual(["Customer / job", "Service", "Technician", "AI status", "Area", "Schedule", "Terms", "Action"]);
    expect(screen.getByLabelText("Total matching jobs")).toHaveTextContent("26");
    expect(screen.getByLabelText("Action counts on this page")).toHaveTextContent("On this page");
    expect(screen.getAllByText("Not checked yet").length).toBeGreaterThan(0);
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("keeps colored filters and rows tied to the displayed advisory state without triggering AI", () => {
    mount();
    const filter = screen.getByRole("button", { name: /Take Job Update/ });
    expect(filter).toHaveAttribute("data-processor-status", "take_job_update");
    fireEvent.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    const row = screen.getAllByRole("row")[1];
    expect(row).toHaveAttribute("data-processor-status", "take_job_update");
    expect(row).toHaveTextContent("John Sample");
    expect(screen.queryAllByLabelText("Review JOB-1002")).toHaveLength(0);
    fireEvent.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByLabelText("Review JOB-1002")).toHaveLength(2);
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows the latest successful check above the job status on desktop, mobile and in the drawer", () => {
    const checkedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const reviewed = { ...job, checked_at: checkedAt, assessment: { status: "payment_pending", evidence: [], messages_reviewed: 1, matched_messages: 1, source: "Quo current history", history_complete: true, timezone: "America/New_York", checked_at: checkedAt, lead_updated_at: job.updated_at, summary: "Verified" } };
    state.hook.mockReturnValue({ data: { rows: [reviewed], total: 1, observed_at: new Date().toISOString() } });
    mount();
    const row = screen.getAllByRole("row")[1];
    const statusCell = within(row).getAllByRole("cell")[3];
    const check = within(statusCell).getByText("Checked 2m ago");
    const badge = within(statusCell).getByText("Payment Pending");
    expect(check.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(check).toHaveAttribute("datetime", checkedAt);
    expect(check.getAttribute("title")).toBeTruthy();
    expect(screen.getByLabelText("Latest job check on this page")).toHaveTextContent("Checked 2m ago");
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
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3];
    expect(cell).toHaveTextContent("Previous check");
    expect(cell).toHaveTextContent("previous check stale · refresh AI");
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
    const cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3];
    expect(cell).toHaveTextContent("Previous check just now");
    expect(cell).toHaveTextContent("Needs Review");
    expect(cell.closest("tr")).toHaveAttribute("data-processor-status", "unavailable");
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
    state.assess.mockImplementation(() => new Promise((done) => { resolve = () => done({ result: reviewResult() }); })); mount();
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
    expect(screen.getByRole("dialog")).toHaveTextContent("Needs Review");
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
    state.assess.mockResolvedValueOnce({ result: reviewResult() }).mockRejectedValueOnce(new ProcessorReviewFailure("Synthetic Quo timeout")); mount();
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
  it("explicitly rechecks fresh history from both the page button and single-job button", async () => {
    const reviewed = { ...job, checked_at: new Date().toISOString(), assessment: { status: "payment_pending", evidence: [], timezone: "America/New_York", checked_at: new Date().toISOString(), lead_updated_at: job.updated_at } };
    state.hook.mockReturnValue({ data: { rows: [reviewed], total: 1 }, refetch: state.refetch }); mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed · 0 failed · 0 skipped"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByLabelText("Review JOB-1001")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
  });
  it("stops after the in-flight job and does not start remaining requests", async () => {
    let finish!: () => void;
    state.assess.mockImplementation(() => new Promise((done) => { finish = () => done({ result: reviewResult() }); }));
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
