import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob, type ProcessorQueue } from "@/lib/processor-board";

const state = vi.hoisted(() => ({ role: "processor", canTechChat: true, chat: vi.fn(), assess: vi.fn(), hook: vi.fn(), refetch: vi.fn(), filters: [] as unknown[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "actor" }, role: state.role, canAccess: () => state.canTechChat }) }));
vi.mock("@/lib/quo-chat", () => ({ fetchQuoChatThread: state.chat, sendQuoChatMessage: vi.fn() }));
vi.mock("@/hooks/useProcessorBoard", () => ({ PROCESSOR_QUERY_KEY: ["processor-board"], useProcessorBoard: (filters: unknown) => { state.filters.push(filters); return state.hook(filters); } }));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));

const chat = { state: "ready" as const, code: "ready", message: "Verified", fingerprint: "fp", conversation_id: "00000000-0000-4000-8000-0000000000c1", last_message_at: "2026-10-20T10:00:00Z", source: "saved_link" as const };
const facts = (overrides: Record<string, unknown> = {}) => ({ policy: 10, tech_phone: "4155550199", enough_context: true, tech_took_job: true, job_update: "none", waiting_since: null, waiting_message_id: null, summary: "Technician accepted the job and has not updated it yet.",
  evidence: [{ signal: "took_job", quote: "Ok I'll take it", message_id: "m2", message_time: "2026-10-08T14:05:00Z", from: "technician", via: "text" }],
  window: { start: "2026-10-08T14:00:00Z", anchor: "customer_mention", anchor_message_id: "m1", messages: 12, omitted: 0 }, call_transcripts: { state: "available", checked: 1, missing: 0, skipped_segments: 0 },
  source: "Quo current history", history_complete: true, ai_used: true, ai_reused: false, checked_at: "2026-10-20T10:05:00Z", lead_updated_at: "2026-10-15T10:00:00Z", status: "take_job_update", ...overrides });
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "LD-1001", customer_name: "Shanice Walker", customer_phone: null, address: "12 Peach St", city: "Atlanta", state: "GA", service_type: "Furniture Assembly", tech_name: "Alex Tech", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only", terms: "quoted", status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-08T15:00:00Z",
  board_status: "take_job_update", ai_stale: false, assessment: facts(), checked_at: "2026-10-20T10:05:00Z", chat_setup: chat };
const future: ProcessorJob = { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "LD-1002", customer_name: "Jeff Moore", scheduled_date: "2099-01-01", board_status: "upcoming", assessment: null, checked_at: null, created_at: "2026-10-20T15:00:00Z" };
const queue = (rows: ProcessorJob[], extra: Partial<ProcessorQueue> = {}): { data: ProcessorQueue; isLoading: false; isFetching: false; isError: false; refetch: typeof state.refetch } =>
  ({ data: { rows, total: rows.length, all_total: 40, counts: { take_job_update: 7, job_in_progress: 5, payment_pending: 9, send_dose: 2, not_enough_details: 3, upcoming: 14 }, observed_at: "2026-10-20T18:00:00Z", timezone: "America/New_York", monitoring: { ai_configured: true, current_history_configured: true, evidence_policy: 10 }, ...extra }, isLoading: false, isFetching: false, isError: false, refetch: state.refetch });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>), client };
}
const rowFor = (jobId: string) => screen.getAllByRole("row").find((row) => row.textContent?.includes(jobId))!;
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks(); state.role = "processor"; state.canTechChat = true; state.filters = [];
  state.chat.mockResolvedValue({ phoneNumber: { id: "PN12345678", number: "+17475887812", formattedNumber: "+17475887812", name: "Technician Communications" }, conversation: null, messages: [] });
  state.assess.mockResolvedValue({ result: facts({ checked_at: new Date().toISOString() }), cached: false });
  state.hook.mockReturnValue(queue([future, job]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Processor Board", () => {
  it("shows lead, technician, service, terms, schedule, AI status and actions in each row", () => {
    mount();
    const row = rowFor("LD-1001");
    for (const text of ["Shanice Walker", "#LD-1001", "Alex Tech", "4155550199", "Furniture Assembly", "Quoted", "Jan 1", "10:00 AM – 12:00 PM", "Take Job Update", "Checked"]) expect(row).toHaveTextContent(text);
    expect(within(row).getByRole("button", { name: "Tech chat for LD-1001" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Review LD-1001" })).toHaveAttribute("aria-expanded", "false");
    expect(within(row).getByRole("link", { name: "Open lead LD-1001" })).toHaveAttribute("href", `/leads/${job.id}`);
    expect(screen.getByLabelText("Jobs on the board")).toHaveTextContent("40");
  });
  it("shows a passed appointment in red and an upcoming one normally", () => {
    mount();
    expect(rowFor("LD-1001").querySelector("[data-overdue]")).toHaveClass("text-red-500");
    expect(rowFor("LD-1001")).toHaveTextContent("Appointment time has passed");
    expect(rowFor("LD-1002").querySelector("[data-overdue]")).toBeNull();
  });
  it("keeps the server's newest-lead order", () => {
    mount();
    const ids = screen.getAllByRole("row").slice(1).map((row) => row.textContent?.match(/#(LD-\d+)/)?.[1]);
    expect(ids).toEqual(["LD-1002", "LD-1001"]);
  });
  it("filters by AI status on the server with board-wide counts", () => {
    mount();
    const group = screen.getByRole("group", { name: "Filter by AI status" });
    for (const [label, count] of [["All", "40"], ["Take Job Update", "7"], ["Job In Progress", "5"], ["Payment Pending", "9"], ["Send Dose", "2"], ["Not enough details in the chat", "3"], ["Upcoming", "14"]]) {
      expect(within(group).getByRole("button", { name: `${label} ${count}` })).toBeInTheDocument();
    }
    fireEvent.click(within(group).getByRole("button", { name: "Send Dose 2" }));
    expect(state.filters.at(-1)).toMatchObject({ aiStatus: "send_dose", offset: 0 });
    expect(within(group).getByRole("button", { name: "Send Dose 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "All 40" }));
    expect(state.filters.at(-1)).toMatchObject({ aiStatus: null });
  });
  it("opens the review inline under the row, not in a sidebar, without calling AI", () => {
    state.hook.mockReturnValue(queue([job]));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    const review = screen.getByRole("region", { name: "Review LD-1001" });
    expect(review.closest("table")).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(review).toHaveTextContent("Technician accepted the job and has not updated it yet.");
    expect(review).toHaveTextContent("“Ok I'll take it”");
    expect(review).toHaveTextContent("Read 12 messages from");
    expect(review).toHaveTextContent("starting where Shanice Walker is first mentioned");
    expect(review).toHaveTextContent("1 call transcript included");
    expect(review).toHaveTextContent("Saved lead status: Scheduled");
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(screen.queryByRole("region", { name: "Review LD-1001" })).not.toBeInTheDocument();
  });
  it("explains when no customer mention was found and when the chat had too little detail", () => {
    state.hook.mockReturnValue(queue([{ ...job, board_status: "not_enough_details", assessment: facts({ enough_context: false, window: { start: "2026-10-07T15:00:00Z", anchor: "lead_created", anchor_message_id: null, messages: 2, omitted: 0 } }) }]));
    mount();
    expect(rowFor("LD-1001")).toHaveTextContent("Not enough details in the chat");
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(screen.getByRole("region", { name: "Review LD-1001" })).toHaveTextContent("no mention of Shanice Walker found, so the chat from the day before the lead was read");
  });
  it("auto-checks only unchecked or changed jobs, once, and patches the row with the server status", async () => {
    const changed = { ...job, ai_stale: true };
    const fresh = { ...job, id: "00000000-0000-4000-8000-000000000003", job_id: "LD-1003" };
    state.hook.mockReturnValue(queue([future, changed, fresh]));
    state.assess.mockResolvedValue({ result: facts({ status: "send_dose", checked_at: new Date().toISOString() }), cached: false });
    mount();
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([future.id, changed.id]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(state.assess).toHaveBeenCalledTimes(2);
  });
  it("does not auto-check when turned off, hidden or AI is not configured", async () => {
    state.hook.mockReturnValue(queue([future], { monitoring: { ai_configured: false, current_history_configured: true } }));
    mount();
    expect(screen.getByText("AI is not configured on the server; ask Admin.")).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(state.assess).not.toHaveBeenCalled();
    cleanup();
    state.hook.mockReturnValue(queue([future]));
    sessionStorage.setItem("processor-tracking:v2:actor:processor:", JSON.stringify({ timezone: "America/New_York", automatic: false }));
    mount();
    expect(screen.getByLabelText("Auto-check changed chats")).not.toBeChecked();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("Refresh AI Status checks every loaded job, skipping setup problems", async () => {
    const blocked = { ...job, id: "00000000-0000-4000-8000-000000000004", job_id: "LD-1004", chat_setup: { ...chat, state: "blocked" as const, message: "Save the technician's Quo chat link." } };
    state.hook.mockReturnValue(queue([job, blocked]));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI Status" }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(1));
    expect(state.assess).toHaveBeenCalledWith(job.id, "America/New_York");
    expect(await screen.findByText(/1 checked · 0 failed\. Saved lead statuses were not changed\./)).toBeInTheDocument();
    expect(rowFor("LD-1004")).toHaveTextContent("Setup needed");
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1004" }));
    expect(screen.getByRole("region", { name: "Review LD-1004" })).toHaveTextContent("Save the technician's Quo chat link.");
    expect(within(screen.getByRole("region", { name: "Review LD-1004" })).getByRole("button", { name: /Check again/ })).toBeDisabled();
  });
  it("reports a failed check on the row without claiming success, and retries from the review", async () => {
    state.hook.mockReturnValue(queue([job]));
    state.assess.mockRejectedValueOnce(new ProcessorReviewFailure("AI provider is unavailable. Previous result is kept; check again.", true, "ai_provider"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI Status" }));
    expect(await screen.findByText(/0 checked · 1 failed/)).toBeInTheDocument();
    expect(rowFor("LD-1001")).toHaveTextContent("Check failed");
    expect(rowFor("LD-1001")).toHaveTextContent("Take Job Update");
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    const review = screen.getByRole("region", { name: "Review LD-1001" });
    expect(review).toHaveTextContent("AI provider is unavailable");
    fireEvent.click(within(review).getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowFor("LD-1001")).not.toHaveTextContent("Check failed"));
  });
  it("opens Tech Quick Chat for the row's technician and respects chat permission", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Tech chat for LD-1001" }));
    await waitFor(() => expect(state.chat).toHaveBeenCalledWith("+14155550199", "tech", chat.conversation_id));
    cleanup();
    state.canTechChat = false;
    mount();
    expect(screen.getByRole("button", { name: "Tech chat for LD-1001" })).toBeDisabled();
  });
  it("debounces search into the server query", async () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/Search lead/), { target: { value: " Shanice " } });
    await waitFor(() => expect(state.filters.at(-1)).toMatchObject({ search: "Shanice", offset: 0 }), { timeout: 2000 });
  });
  it("shows a recovery action when the board cannot load", () => {
    state.hook.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error("Processor Board database setup is unavailable."), refetch: state.refetch });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading board" }));
    expect(state.refetch).toHaveBeenCalled();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it.each(["customer_service", "cs_admin", "opr", "opr_admin"])("blocks %s without reading the board", (role) => {
    state.role = role;
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("restricted to Admin and Processor");
    expect(state.hook).not.toHaveBeenCalled();
  });
});
