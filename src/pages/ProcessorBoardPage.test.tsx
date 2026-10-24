import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob, type ProcessorQueue } from "@/lib/processor-board";

const state = vi.hoisted(() => ({ role: "processor", canTechChat: true, chat: vi.fn(), assess: vi.fn(), detail: vi.fn(), hook: vi.fn(), refetch: vi.fn(), filters: [] as unknown[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "actor" }, role: state.role, canAccess: () => state.canTechChat }) }));
vi.mock("@/lib/quo-chat", () => ({ fetchQuoChatThread: state.chat, sendQuoChatMessage: vi.fn() }));
vi.mock("@/hooks/useProcessorBoard", () => ({
  PROCESSOR_QUERY_KEY: ["processor-board"],
  useProcessorBoard: (filters: unknown) => { state.filters.push(filters); return state.hook(filters); },
  useProcessorDetail: (job: { id: string } | null) => state.detail(job),
}));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));

const chat = { state: "ready" as const, code: "ready", message: "Verified", fingerprint: "fp", conversation_id: "00000000-0000-4000-8000-0000000000c1", last_message_at: "2026-10-20T10:00:00Z", source: "saved_link" as const };
const facts = (overrides: Record<string, unknown> = {}) => ({ policy: 10, tech_phone: "4155550199", enough_context: true, tech_took_job: true, job_update: "none", waiting_since: null, waiting_message_id: null, summary: "Technician accepted the job and has not updated it yet.",
  evidence: [{ signal: "took_job", quote: "Ok I'll take it", message_id: "m2", message_time: "2026-10-08T14:05:00Z", from: "technician", via: "text" }],
  window: { start: "2026-10-08T14:00:00Z", anchor: "customer_mention", anchor_message_id: "m1", messages: 12, omitted: 0 }, call_transcripts: { state: "available", checked: 1, missing: 0, skipped_segments: 0 },
  source: "Quo current history", history_complete: true, ai_used: true, ai_reused: false, checked_at: "2026-10-20T10:05:00Z", lead_updated_at: "2026-10-15T10:00:00Z", status: "take_job_update", ...overrides });
const summary = { policy: 10, tech_phone: "4155550199", job_update: "none", tech_took_job: true, enough_context: true };
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "LD-1001", customer_name: "Shanice Walker", customer_phone: null, address: "12 Peach St", city: "Atlanta", state: "GA", service_type: "Furniture Assembly", tech_name: "Alex Tech", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only", terms: "quoted", status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-08T15:00:00Z",
  board_status: "take_job_update", ai_stale: false, ai_summary: summary, checked_at: "2026-10-20T10:05:00Z", chat_setup: chat };
const future: ProcessorJob = { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "LD-1002", customer_name: "Jeff Moore", scheduled_date: "2099-01-01", board_status: "upcoming", ai_summary: null, checked_at: null, created_at: "2026-10-20T15:00:00Z" };
const queue = (rows: ProcessorJob[], extra: Partial<ProcessorQueue> = {}) =>
  ({ data: { rows, total: rows.length, all_total: 40, counts: { take_job_update: 7, job_in_progress: 5, payment_pending: 6, send_dose: 2, wrong_tech_number: 4, not_enough_details: 3, upcoming: 13 }, observed_at: "2026-10-20T18:00:00Z", timezone: "America/New_York", monitoring: { ai_configured: true, current_history_configured: true, evidence_policy: 10 }, ...extra }, isLoading: false, isFetching: false, isError: false, refetch: state.refetch });
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
  state.detail.mockReturnValue({ data: facts(), isLoading: false, isError: false });
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
  it("never runs AI just because the board was opened, even for unchecked or changed jobs", async () => {
    state.hook.mockReturnValue(queue([future, { ...job, ai_stale: true }]));
    mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(state.assess).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Auto-check changed chats")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh AI Status/ })).not.toBeInTheDocument();
    expect(rowFor("LD-1002")).toHaveTextContent("Waiting for its first server check");
    expect(rowFor("LD-1001")).toHaveTextContent("new activity, server re-checks soon");
    expect(screen.getByText(/Opening the board never runs AI/)).toBeInTheDocument();
  });
  it("Refresh only reloads the board", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(state.refetch).toHaveBeenCalled();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows every job in one list with no paging controls", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...future, id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`, job_id: `LD-${2000 + i}` }));
    state.hook.mockReturnValue(queue(many));
    mount();
    expect(screen.getAllByRole("row")).toHaveLength(41);
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    expect(screen.getByText("40 jobs · leads from the last 30 days · newest first")).toBeInTheDocument();
    expect(state.filters.at(-1)).not.toHaveProperty("offset");
  });
  it("shows a passed appointment in red and an upcoming one normally", () => {
    mount();
    expect(rowFor("LD-1001").querySelector("[data-overdue]")).toHaveClass("text-red-500");
    expect(rowFor("LD-1002").querySelector("[data-overdue]")).toBeNull();
  });
  it("keeps the server's newest-lead order", () => {
    mount();
    expect(screen.getAllByRole("row").slice(1).map((row) => row.textContent?.match(/#(LD-\d+)/)?.[1])).toEqual(["LD-1002", "LD-1001"]);
  });
  it("filters by AI status on the server, with Wrong Tech Number and no Payment Overdue", () => {
    mount();
    const group = screen.getByRole("group", { name: "Filter by AI status" });
    for (const [label, count] of [["All", "40"], ["Take Job Update", "7"], ["Job In Progress", "5"], ["Payment Pending", "6"], ["Send Dose", "2"], ["Wrong Tech Number", "4"], ["Not enough details in the chat", "3"], ["Upcoming", "13"]]) {
      expect(within(group).getByRole("button", { name: `${label} ${count}` })).toBeInTheDocument();
    }
    expect(within(group).queryByRole("button", { name: /Payment Overdue/ })).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Wrong Tech Number 4" }));
    expect(state.filters.at(-1)).toMatchObject({ aiStatus: "wrong_tech_number" });
    fireEvent.click(within(group).getByRole("button", { name: "All 40" }));
    expect(state.filters.at(-1)).toMatchObject({ aiStatus: null });
  });
  it("flags a wrong tech number on the row and blocks checking it", () => {
    const wrong = { ...job, job_id: "LD-1009", tech_number: "415555019", board_status: "wrong_tech_number" as const, ai_summary: null, checked_at: null };
    state.hook.mockReturnValue(queue([wrong]));
    state.detail.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mount();
    expect(rowFor("LD-1009")).toHaveTextContent("Wrong Tech Number");
    expect(rowFor("LD-1009")).toHaveTextContent("Fix the tech number on the lead");
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1009" }));
    const review = screen.getByRole("region", { name: "Review LD-1009" });
    expect(review).toHaveTextContent("valid 10-digit");
    expect(within(review).getByRole("button", { name: /Check again/ })).toBeDisabled();
  });
  it("opens the review inline, loading its full evidence only then", () => {
    state.hook.mockReturnValue(queue([job]));
    mount();
    expect(state.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(state.detail).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    const review = screen.getByRole("region", { name: "Review LD-1001" });
    expect(review.closest("table")).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(review).toHaveTextContent("Technician accepted the job and has not updated it yet.");
    expect(review).toHaveTextContent("“Ok I'll take it”");
    expect(review).toHaveTextContent("starting where Shanice Walker is first mentioned");
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("shows loading and load failure for the review honestly", () => {
    state.hook.mockReturnValue(queue([job]));
    state.detail.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(screen.getByLabelText("Loading review")).toBeInTheDocument();
    cleanup();
    state.detail.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(within(screen.getByRole("region", { name: "Review LD-1001" })).getByRole("alert")).toHaveTextContent("could not be loaded");
  });
  it("shows our share and the job timeline for a done, unpaid job", () => {
    const step = (at: string, quote: string) => ({ at, message_id: `m-${at}`, quote });
    const timeline = { job_tag: "2", details: step("2026-10-08T14:00:00Z", "*Customer # 2* ..."), took_job: step("2026-10-08T14:05:00Z", "Yes"), visit_confirmed: null, update_requested: null,
      completed: { ...step("2026-10-15T15:00:00Z", "Done ✅"), by: "technician" }, share_requested: step("2026-10-15T15:10:00Z", "Active Zelle: ..."), share_promised: null, share_sent: null, share_received: null,
      share_state: "requested", other_jobs_in_window: false };
    state.hook.mockReturnValue(queue([{ ...job, board_status: "send_dose", ai_summary: { ...summary, job_update: "completed", share_state: "requested", share_at: "2026-10-15T15:10:00Z", checked_by: "daily_check" } }]));
    state.detail.mockReturnValue({ data: facts({ job_update: "completed", completed_at: "2026-10-15T15:00:00Z", share_state: "requested", timeline, rules_only: true, checked_by: "daily_check" }), isLoading: false, isError: false });
    mount();
    expect(rowFor("LD-1001")).toHaveTextContent("Send Dose");
    expect(rowFor("LD-1001")).toHaveTextContent("Share requested · Oct 15");
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    const steps = screen.getByRole("region", { name: "Job timeline" });
    expect(steps).toHaveTextContent("*Customer # 2*");
    expect(steps).toHaveTextContent("✓ Technician took the job");
    expect(steps).toHaveTextContent("“Yes”");
    expect(steps).toHaveTextContent("✓ Job completed");
    expect(steps).toHaveTextContent("– Tech says share sent");
    expect(steps).toHaveTextContent("no AI was needed");
    expect(screen.getByRole("region", { name: "Our share" })).toHaveTextContent("until the technician sends our share");
    expect(screen.getByRole("region", { name: "Review LD-1001" })).toHaveTextContent("by the daily check");
  });
  it("says when this lead's details message was not found in the chat", () => {
    state.hook.mockReturnValue(queue([job]));
    state.detail.mockReturnValue({ data: facts({ timeline: { job_tag: null, details: null, took_job: null, visit_confirmed: null, update_requested: null, completed: null, share_requested: null, share_promised: null, share_sent: null, share_received: null, share_state: "none", other_jobs_in_window: false } }), isLoading: false, isError: false });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    expect(screen.getByRole("region", { name: "Job timeline" })).toHaveTextContent("customer-details message was not found");
  });
  it("Check again checks only that job, once, then reloads the board", async () => {
    state.hook.mockReturnValue(queue([job, future]));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Review LD-1001" })).getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(1));
    expect(state.assess).toHaveBeenCalledWith(job.id, "America/New_York");
  });
  it("reports a failed check on the row without claiming success", async () => {
    state.hook.mockReturnValue(queue([job]));
    state.assess.mockRejectedValueOnce(new ProcessorReviewFailure("AI provider is unavailable. Previous result is kept; check again.", true, "ai_provider"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Review LD-1001" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Review LD-1001" })).getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(rowFor("LD-1001")).toHaveTextContent("Check failed"));
    expect(rowFor("LD-1001")).toHaveTextContent("Take Job Update");
    expect(screen.getByRole("region", { name: "Review LD-1001" })).toHaveTextContent("AI provider is unavailable");
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
    await waitFor(() => expect(state.filters.at(-1)).toMatchObject({ search: "Shanice" }), { timeout: 2000 });
  });
  it("shows a recovery action when the board cannot load", () => {
    state.hook.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error("Processor Board database setup is unavailable."), refetch: state.refetch });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading board" }));
    expect(state.refetch).toHaveBeenCalled();
  });
  it.each(["customer_service", "cs_admin", "opr", "opr_admin"])("blocks %s without reading the board", (role) => {
    state.role = role;
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("restricted to Admin and Processor");
    expect(state.hook).not.toHaveBeenCalled();
  });
});
