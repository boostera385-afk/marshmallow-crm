import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessorBoardPage from "./ProcessorBoardPage";
import { ProcessorReviewFailure, type ProcessorJob } from "@/lib/processor-board";
const state = vi.hoisted(() => ({ role: "processor", user: "actor", rows: [] as ProcessorJob[], assess: vi.fn(), hook: vi.fn(), configured: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: state.user }, role: state.role, canAccess: () => true }) }));
vi.mock("@/hooks/useProcessorBoard", () => ({ PROCESSOR_QUERY_KEY: ["processor-board"], useProcessorBoard: state.hook }));
vi.mock("@/lib/processor-board", async (load) => ({ ...await load<object>(), assessProcessorJob: state.assess }));
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
  return { ...view, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.role = "processor"; state.user = "actor"; state.rows = [structuredClone(job)]; state.configured = true;
  state.assess.mockImplementation(async (id: string) => reviewed(id));
  state.hook.mockImplementation(() => ({ data: { rows: state.rows, total: state.rows.length, observed_at: new Date().toISOString(), monitoring: { ai_configured: state.configured, current_history_configured: true } }, isFetching: false, isError: false }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("automatic tracking while the board is open", () => {
  it("requires explicit schedule-timezone confirmation, checks once and reuses fresh evidence", async () => {
    const view = mount();
    expect(screen.getByLabelText("Automatic AI tracking")).toBeChecked();
    expect(screen.getByLabelText("Automatic tracking state")).toHaveTextContent("Tracking not started");
    expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeDisabled();
    expect(state.assess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Automatic check: 1 reviewed"));
    expect(state.assess).toHaveBeenCalledExactlyOnceWith(job.id, "America/New_York");
    expect(screen.getAllByText("Schedule rule · AI found no verified job update")).toHaveLength(2);
    expect(state.rows[0].status).toBe("scheduled");
    expect(screen.getByLabelText("Evidence quality on this page")).toHaveTextContent("1 fresh successful checks · 0 with a technician reply tied to the job");
    view.update(); expect(state.assess).toHaveBeenCalledTimes(1);
  });
  it("gates manual checks and schedule-derived actions until timezone confirmation even when automatic tracking is off", async () => {
    mount(); fireEvent.click(screen.getByLabelText("Automatic AI tracking"));
    expect(screen.getByLabelText("Automatic tracking state")).toHaveTextContent("Tracking paused");
    expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeDisabled();
    expect(screen.getAllByText("Needs Review", { exact: true })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
    expect(screen.getByRole("button", { name: "Check this job" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByLabelText("Confirm schedule timezone"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI · this page" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("0 with a technician reply tied to the job · 1 without a tied technician reply"));
    expect(state.assess).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Schedule timezone"), { target: { value: "America/Chicago" } });
    expect(screen.getByLabelText("Confirm schedule timezone")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Refresh AI · this page" })).toBeDisabled();
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
    expect(screen.getAllByText(/7 technician replies were not tied to this job/)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
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
    expect(screen.getAllByText(/No progress or completion is verified yet/)).toHaveLength(2);
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
