import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob } from "@/lib/processor-board";
const state = vi.hoisted(() => ({ role: "processor", user: "actor", rows: [] as ProcessorJob[], assess: vi.fn(), hook: vi.fn(), configured: true, fetching: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: state.user }, role: state.role, canAccess: () => true }) }));
vi.mock("@/hooks/useProcessorBoard", () => ({ PROCESSOR_QUERY_KEY: ["processor-board"], useProcessorBoard: state.hook }));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));
vi.mock("@/components/leads/QuoPhoneTrigger", () => ({ default: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Return from synthetic chat</button> }));
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-AUTO-1", customer_name: "Synthetic Customer", customer_phone: null, service_type: "Repair", address: "10 Sample St", city: "Synthetic", state: "FL", tech_name: "Synthetic Tech", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-01-01T00:00:00Z", checked_at: null, assessment: null,
  chat_setup: { state: "ready", code: "ready", message: "Verified", fingerprint: "setup-a", conversation_id: "00000000-0000-4000-8000-000000000002", last_message_at: null, source: "verified_mirror" } };
function reviewed(id: string) {
  const row = state.rows.find((r) => r.id === id)!;
  const checked_at = new Date().toISOString();
  const result: NonNullable<ProcessorJob["assessment"]> = { status: "take_job_update", evidence: [], messages_reviewed: 12, matched_messages: 2, source: "Quo current history", history_complete: true, ai_used: true, chat_fingerprint: row.chat_setup?.fingerprint, timezone: "America/New_York", checked_at, lead_updated_at: row.updated_at, summary: "No verified update" };
  state.rows = state.rows.map((r) => r.id === id ? { ...r, assessment: result, checked_at } : r);
  return { result, cached: false };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><ProcessorBoardPage /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  const options = screen.queryByText("Filters & tracking", { exact: true });
  if (options) fireEvent.click(options);
  return { ...view, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks(); state.role = "processor"; state.user = "actor"; state.rows = [structuredClone(job)]; state.configured = true; state.fetching = false;
  state.assess.mockImplementation(async (id: string) => reviewed(id));
  state.hook.mockImplementation(() => ({ data: { rows: state.rows, total: state.rows.length, observed_at: new Date().toISOString(), monitoring: { ai_configured: state.configured, current_history_configured: true } }, isFetching: state.fetching, isError: false }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("automatic tracking while the board is open", () => {
  it("retains unread focused activity when returning from chat during a board recovery read", async () => {
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-1" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Open technician chat in CRM" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    state.fetching = true;
    state.rows[0] = { ...state.rows[0], chat_setup: { ...job.chat_setup!, fingerprint: "activity-during-chat", last_message_at: "2026-10-23T16:00:00Z" } };
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Return from synthetic chat" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("JOB-AUTO-1");
    state.fetching = false;
    view.update();
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(state.rows[0].assessment?.chat_fingerprint).toBe("activity-during-chat");
  });
  it("automatically rechecks new activity for only the reviewed job, not another changed page job", async () => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-2" })[0]);
    expect(state.assess).toHaveBeenCalledTimes(2);
    state.rows = state.rows.map((row) => ({ ...row, chat_setup: { ...row.chat_setup!, fingerprint: "new-chat-message", last_message_at: "2026-10-23T16:00:00Z" } }));
    view.update();
    await waitFor(() => expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second", "second"]));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(3);
    expect(state.rows[0].assessment?.chat_fingerprint).toBe("setup-a");
    expect(state.rows[1].assessment?.chat_fingerprint).toBe("new-chat-message");
  });
  it.each(["paused", "hidden", "assignment"])("does not auto-check a focused chat update while %s", async (reason) => {
    state.configured = false;
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    if (reason === "paused") fireEvent.click(screen.getByLabelText("Automatic AI tracking"));
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-1" })[0]);
    if (reason === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
    }
    state.configured = true;
    state.rows = [{ ...state.rows[0], ...(reason === "assignment" ? { tech_number: "4155550188", updated_at: "2026-10-23T15:00:00Z" } : {}), chat_setup: { ...job.chat_setup!, fingerprint: "new-message", last_message_at: "2026-10-23T16:00:00Z" } }];
    view.update();
    expect(state.assess).not.toHaveBeenCalled();
  });
  it("recovers a failed activity check with job-only retry, without a tight automatic loop", async () => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-1" })[0]);
    state.assess.mockRejectedValueOnce(new ProcessorReviewFailure("Synthetic new-message failure", true));
    state.rows[0] = { ...state.rows[0], chat_setup: { ...job.chat_setup!, fingerprint: "new-message", last_message_at: "2026-10-23T16:00:00Z" } };
    view.update();
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Synthetic new-message failure"));
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(3);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument());
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second", job.id, job.id]);
  });
  it("retains a newer chat burst arriving during a focused check and runs one trailing check", async () => {
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-1" })[0]);
    let finish!: (response: ReturnType<typeof reviewed>) => void;
    state.assess.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const previous = state.rows[0].assessment!;
    state.rows[0] = { ...state.rows[0], chat_setup: { ...job.chat_setup!, fingerprint: "activity-1", last_message_at: "2026-10-23T16:00:00Z" } };
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(2);
    state.rows[0] = { ...state.rows[0], chat_setup: { ...job.chat_setup!, fingerprint: "activity-2", last_message_at: "2026-10-23T16:01:00Z" } };
    for (let i = 0; i < 20; i++) view.update();
    expect(state.assess).toHaveBeenCalledTimes(2);
    await act(async () => finish({ result: { ...previous, checked_at: new Date().toISOString(), chat_fingerprint: "activity-1" }, cached: false }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(3);
    expect(state.rows[0].assessment?.chat_fingerprint).toBe("activity-2");
  });
  it("prioritizes only the selected job after the active request and resumes page tracking only on close", async () => {
    state.rows.push({ ...job, id: "second", job_id: "JOB-AUTO-2" }, { ...job, id: "third", job_id: "JOB-AUTO-3" });
    const finish = new Map<string, () => void>();
    state.assess.mockImplementation((id: string) => new Promise((resolve) => { finish.set(id, () => resolve(reviewed(id))); }));
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-2" })[0]);
    const dialog = screen.getByRole("dialog");
    const check = within(dialog).getByRole("button", { name: "Check this job" });
    expect(check).toBeEnabled();
    expect(check).toHaveAttribute("aria-busy", "false");
    fireEvent.click(check);
    expect(check).toBeDisabled();
    expect(check).toHaveTextContent("Queued · this job only");
    expect(within(dialog).getByLabelText("This job check")).toHaveTextContent("Waiting for #JOB-AUTO-1");
    expect(state.assess).toHaveBeenCalledTimes(1);
    await act(async () => finish.get(job.id)!());
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second"]);
    expect(check).toHaveAttribute("aria-busy", "true");
    await act(async () => finish.get("second")!());
    expect(check).toBeEnabled();
    expect(check).toHaveAttribute("aria-busy", "false");
    view.update();
    expect(state.assess).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Automatic AI tracking")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(3));
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second", "third"]);
    await act(async () => finish.get("third")!());
  });
  it("opening review alone stops the remaining batch without triggering a check for that job", async () => {
    state.rows.push({ ...job, id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-2" })[0]);
    await act(async () => finish());
    expect(state.assess).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Check this job" })).toBeEnabled();
    expect(screen.getByLabelText("Automatic tracking state")).toHaveTextContent("reviewing one job");
  });
  it("reuses an already active selected-job check without duplicating it or continuing other jobs", async () => {
    state.rows.push({ ...job, id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-1" })[0]);
    const check = within(screen.getByRole("dialog")).getByRole("button", { name: "Check this job" });
    expect(check).toBeDisabled();
    expect(check).toHaveAttribute("aria-busy", "true");
    fireEvent.click(check);
    await act(async () => finish());
    expect(state.assess).toHaveBeenCalledTimes(1);
    expect(check).toBeEnabled();
  });
  it("retries a failed selected-job check without invoking the other jobs", async () => {
    state.configured = false;
    state.rows.push({ ...job, id: "second", job_id: "JOB-AUTO-2" });
    state.assess.mockRejectedValueOnce(new ProcessorReviewFailure("Synthetic selected-job provider failure", true));
    mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-2" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Synthetic selected-job provider failure"));
    const check = within(dialog).getByRole("button", { name: "Check this job" });
    expect(check).toBeEnabled();
    expect(check).toHaveAttribute("aria-busy", "false");
    fireEvent.click(check);
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual(["second", "second"]);
    expect(state.rows[0].assessment).toBeNull();
  });
  it.each(["close", "scope", "assignment", "hidden"])("retires a queued selected-job check after %s", async (reason) => {
    state.rows.push({ ...job, id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getAllByRole("button", { name: "Review JOB-AUTO-2" })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Check this job" }));
    if (reason === "close") {
      state.configured = false; view.update();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    } else if (reason === "scope") {
      state.rows = [state.rows[0]]; view.update();
    } else if (reason === "assignment") {
      state.rows[1] = { ...state.rows[1], tech_number: "4155550188", updated_at: "2026-10-23T12:00:00Z" }; view.update();
    } else {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
    }
    await act(async () => finish());
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("shows checking and queued states on opening, not a fabricated Scheduled AI finding", async () => {
    state.rows = [{ ...job, scheduled_date: "2099-01-01" }, { ...job, id: "second", job_id: "JOB-AUTO-2", scheduled_date: "2099-01-02" }];
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(screen.getAllByText("Checking…", { exact: true })).toHaveLength(2);
    expect(screen.getAllByText("Queued for check", { exact: true })).toHaveLength(2);
    expect(screen.queryByText("No action yet", { exact: true })).not.toBeInTheDocument();
    expect(state.assess).toHaveBeenCalledExactlyOnceWith(job.id, "America/New_York");
    await act(async () => finish());
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
  });
  it("remembers explicit confirmation on reopening without sharing it with another caller", async () => {
    const first = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    first.unmount();
    state.rows = [structuredClone(job)];
    const second = mount();
    expect(screen.getByLabelText("Confirm schedule timezone")).toBeChecked();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    expect(state.assess).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText("Automatic AI tracking"));
    second.unmount();
    const paused = mount();
    expect(screen.getByLabelText("Automatic AI tracking")).not.toBeChecked();
    paused.unmount();
    state.user = "another-user";
    mount();
    expect(screen.getByLabelText("Confirm schedule timezone")).not.toBeChecked();
    expect(state.assess).toHaveBeenCalledTimes(2);
  });
  it("queues a manual check behind the automatic job without duplicate or concurrent requests", async () => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI next · this page" }));
    expect(screen.getByRole("button", { name: "Manual check queued" })).toBeDisabled();
    expect(screen.getByLabelText("Automatic AI tracking")).not.toBeChecked();
    expect(state.assess).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeEnabled());
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second"]);
  });
  it("requires explicit schedule-timezone confirmation, checks once and reuses fresh evidence", async () => {
    const view = mount();
    expect(screen.getByLabelText("Automatic AI tracking")).toBeChecked();
    expect(screen.getByLabelText("Automatic tracking state")).toHaveTextContent("Tracking not started");
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    expect(screen.getByRole("status")).toHaveTextContent("Confirm the saved schedules' timezone below once");
    expect(screen.getByLabelText("Confirm schedule timezone")).toHaveFocus();
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Automatic check: 1 reviewed"));
    expect(state.assess).toHaveBeenCalledExactlyOnceWith(job.id, "America/New_York");
    expect(screen.getAllByText("Schedule rule · AI found no verified job update")).toHaveLength(2);
    expect(state.rows[0].status).toBe("scheduled");
    expect(screen.getByLabelText("Evidence quality on this page")).toHaveTextContent("1 fresh successful checks · 0 with a technician reply tied to the job");
    view.update(); expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it.each(["hidden", "scope", "stop"])("retires a queued manual batch after %s without starting another request", async (reason) => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((resolve) => { finish = () => resolve(reviewed(id)); }));
    const view = mount();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI next · this page" }));
    if (reason === "hidden") {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      fireEvent(document, new Event("visibilitychange"));
    } else if (reason === "scope") {
      state.rows = [state.rows[0]];
      view.update();
    } else fireEvent.click(screen.getByRole("button", { name: "Stop after current job" }));
    await act(async () => finish());
    expect(state.assess).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("gates manual checks and schedule-derived actions until timezone confirmation even when automatic tracking is off", async () => {
    mount(); fireEvent.click(screen.getByLabelText("Automatic AI tracking"));
    expect(screen.getByLabelText("Automatic tracking state")).toHaveTextContent("Tracking paused");
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    expect(state.assess).not.toHaveBeenCalled();
    expect(screen.getAllByText("Needs Review", { exact: true })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
    expect(screen.getByRole("button", { name: "Check this job" })).toBeDisabled();
    expect(screen.getByText(/Close this review and confirm the schedule timezone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("0 with a technician reply tied to the job · 1 without a tied technician reply"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Schedule timezone"), { target: { value: "America/Chicago" } });
    expect(screen.getByLabelText("Confirm schedule timezone")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("exposes unattributed replies and opens only the verified chat for manual checking", async () => {
    state.rows = [{ ...job, chat_setup: { ...job.chat_setup!, chat_url: "https://my.quo.com/inbox/PN12345678/c/CN12345678" } }];
    state.assess.mockImplementation(async (id: string) => {
      const response = reviewed(id);
      response.result.matched_technician_messages = 0;
      response.result.unattributed_technician_messages = 7;
      state.rows[0].assessment = response.result;
      return response;
    });
    mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("7 technician replies were not tied to this job");
    expect(screen.getByRole("button", { name: "Open technician chat in CRM" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Open verified technician chat" })).not.toBeInTheDocument();
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("counts an attributed reply even when it establishes no progress or completion", async () => {
    state.assess.mockImplementation(async (id: string) => {
      const response = reviewed(id);
      response.result.matched_technician_messages = 0;
      response.result.context_technician_messages = 2;
      response.result.unattributed_technician_messages = 1;
      state.rows[0].assessment = response.result;
      return response;
    });
    mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 with a technician reply tied to the job · 0 without a tied technician reply"));
    expect(screen.getByLabelText("Evidence quality on this page")).toHaveTextContent("1 with a technician reply tied to the job");
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("No progress or completion is verified yet");
    expect(state.rows[0].status).toBe("scheduled");
    expect(state.rows[0].assessment?.status).toBe("take_job_update");
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("stops starting jobs when hidden, resumes when visible and preserves the current result", async () => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((done) => { finish = () => done(reviewed(id)); }));
    mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 not started"));
    expect(state.assess).toHaveBeenCalledTimes(1); expect(state.rows[0].assessment).not.toBeNull();
    visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(state.assess).toHaveBeenCalledTimes(2));
    expect(state.assess.mock.calls.map(([id]) => id)).toEqual([job.id, "second"]);
  });
  it("stops the remaining batch on unmount and does not start checks for another caller", async () => {
    state.rows.push({ ...structuredClone(job), id: "second", job_id: "JOB-AUTO-2" });
    let finish!: () => void;
    state.assess.mockImplementationOnce((id: string) => new Promise((done) => { finish = () => done(reviewed(id)); }));
    const view = mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    view.unmount(); await act(async () => finish());
    expect(state.assess).toHaveBeenCalledTimes(1);
    state.user = "another-user"; mount();
    expect(screen.getByLabelText("Confirm schedule timezone")).not.toBeChecked();
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("does not invoke AI for blocked setup and recovers when verified saved metadata changes", async () => {
    state.rows = [{ ...job, chat_setup: { ...job.chat_setup!, state: "blocked", code: "missing_chat_link", message: "Save a verified chat link" } }];
    const view = mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(state.assess).not.toHaveBeenCalled();
    expect(screen.getAllByText("Save a verified chat link")).toHaveLength(2);
    state.rows = [{ ...job, chat_setup: { ...job.chat_setup!, fingerprint: "corrected-setup" } }];
    view.update();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed"));
    expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("backs off after a provider failure and permits an explicit failed-only retry", async () => {
    state.assess.mockRejectedValueOnce(new ProcessorReviewFailure("Synthetic provider unavailable", true));
    const view = mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 failed"));
    view.update(); expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry failed · 1" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 reviewed · 0 failed"));
    expect(state.assess).toHaveBeenCalledTimes(2);
  });
  it("keeps automatic checks paused when AI is unconfigured or the user disables tracking", () => {
    state.configured = false; mount(); fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Automatic AI tracking"));
    expect(screen.getByText("Paused. Manual checks remain available.")).toBeInTheDocument();
  });
  it.each(["opr", "opr_admin", "customer_service", "cs_admin"])("never reads or tracks jobs for %s", (role) => {
    state.role = role; mount(); expect(screen.getByRole("alert")).toHaveTextContent("restricted");
    expect(state.hook).not.toHaveBeenCalled(); expect(state.assess).not.toHaveBeenCalled();
  });
});
