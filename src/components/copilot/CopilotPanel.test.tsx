import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotPanel from "./CopilotPanel";
import { CopilotApiError } from "@/lib/copilot-api";
import { emptyCopilotResult, type CopilotAccess, type CopilotResult } from "../../../supabase/functions/_shared/copilot-core";
const state = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { full_name: "Synthetic Admin" } }) }));
vi.mock("@/hooks/useAllowedStatuses", () => ({ useAllowedStatuses: () => ({ allowedStatuses: new Set(["urgent_job"]) }) }));
vi.mock("@/lib/copilot-api", async (original) => ({ ...await original<typeof import("@/lib/copilot-api")>(), askCopilot: state.ask }));
const close = vi.fn();
const access: CopilotAccess = { allowed: true, aiEnabled: true, role: "admin", timezone: "America/New_York", sections: ["leads", "schedule", "technicians", "settings"] };
let client: QueryClient;
function panel(permissions = access) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Session() {
    const [minimized, setMinimized] = useState(false);
    return <CopilotPanel access={permissions} minimized={minimized} onMinimizedChange={setMinimized} onClose={close}/>;
  }
  return render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Session/></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); state.ask.mockReset(); close.mockReset(); Element.prototype.scrollIntoView = vi.fn(); state.ask.mockResolvedValue(emptyCopilotResult("features")); });
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });
describe("Copilot panel", () => {
  it("opens professionally, offers only permitted tools and leaves AI off", async () => {
    panel({ ...access, role: "opr", aiEnabled: false, sections: ["leads"] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "How may I help you today?" })).toBeVisible());
    expect(screen.getByRole("button", { name: "Find a lead" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Find a technician" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "System health" })).not.toBeInTheDocument();
    expect(state.ask).not.toHaveBeenCalled();
  });
  it("submits an explicit deterministic search and preserves filter values", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Find a lead" }));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByLabelText("Filter service"), { target: { value: "Plumbing" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "MM-101" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" }));
    await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(1));
    expect(state.ask.mock.calls[0][0]).toMatchObject({ intent: "leads", query: "MM-101", service: "Plumbing", allowAi: false });
  });
  it("shows unavailable metrics distinctly from zero, and renders untrusted text literally", async () => {
    const result: CopilotResult = { ...emptyCopilotResult("report"), text: '<img src=x onerror="alert(1)">', metrics: [
      { label: "Scheduled", value: null, description: "No access" }, { label: "Incomplete", value: 0, description: "Saved status" },
    ] };
    state.ask.mockResolvedValue(result); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    expect(await screen.findByText("Unavailable")).toBeVisible(); expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText(result.text)).toBeVisible(); expect(document.querySelector("img")).toBeNull();
  });
  it("does not double submit a question while one is in flight", async () => {
    let resolve: (result: CopilotResult) => void;
    state.ask.mockImplementation(() => new Promise<CopilotResult>((done) => { resolve = done; })); panel();
    const suggestion = screen.getByRole("button", { name: "My daily report" });
    fireEvent.click(suggestion); fireEvent.click(suggestion);
    expect(state.ask).toHaveBeenCalledTimes(1);
    resolve!(emptyCopilotResult("report")); await screen.findByText(/Checked/);
  });
  it("separates backend failures from outcomes and never automatically retries AI", async () => {
    state.ask.mockRejectedValue(new CopilotApiError("AI unavailable", 503)); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI unavailable");
    expect(state.ask).toHaveBeenCalledTimes(1);
  });
  it("closes and discards session results on server access denial", async () => {
    state.ask.mockRejectedValue(new CopilotApiError("Access changed", 403)); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("uses the resolved search query for next page without another AI turn", async () => {
    state.ask.mockResolvedValue({ ...emptyCopilotResult("leads"), aiUsed: true, searchQuery: "MM-101", hasMore: true, nextOffset: 10 }); panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "look up reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show more results" }));
    await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0]).toMatchObject({ query: "MM-101", offset: 10, allowAi: false });
    expect(screen.getAllByText("CRM result · AI routing").length).toBeGreaterThan(0);
  });
  it("paginates a refined search using the server's interpreted filters", async () => {
    state.ask.mockResolvedValue({ ...emptyCopilotResult("leads"), searchQuery: "", hasMore: true, nextOffset: 10,
      followup: { intent: "leads", query: "", area: "Miami", service: "plumbing", status: "urgent_job", date: "2026-10-15" } }); panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "Find urgent plumbing leads in Miami tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show more results" }));
    await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0]).toMatchObject({ intent: "leads", offset: 10, query: "", area: "Miami", service: "plumbing", status: "urgent_job", date: "2026-10-15", allowAi: false });
  });
  it("explains with a new explicit question, not the previous deterministic question", async () => {
    state.ask.mockResolvedValue(emptyCopilotResult("report")); panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "My report about PRIVATE ORIGINAL QUESTION" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" }));
    fireEvent.click(await screen.findByRole("button", { name: "Explain with AI (uses allowance)" }));
    await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0]).toMatchObject({ message: "Explain my work report", intent: "explain_report", allowAi: true });
    expect(state.ask.mock.calls[1][0].requestId).not.toBe(state.ask.mock.calls[0][0].requestId);
  });
  it("keeps failed questions editable and retries only on explicit click with a fresh ID", async () => {
    state.ask.mockRejectedValueOnce(new CopilotApiError("Provider billing blocked", 429, "provider_billing", "trace-1")); panel();
    fireEvent.click(screen.getByRole("switch", { name: "Allow AI-assisted mode" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "What is a heat pump?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("trace-1");
    expect(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue("What is a heat pump?");
    expect(state.ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Retry manually/ })); await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0].requestId).not.toBe(state.ask.mock.calls[0][0].requestId);
  });
  it("passes validated previous search even while in a search mode", async () => {
    state.ask.mockResolvedValue({ ...emptyCopilotResult("leads"), followup: { intent: "leads", query: "MM-101", area: "Miami" } }); panel();
    fireEvent.click(screen.getByRole("button", { name: "Find a lead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "MM-101" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" })); await screen.findByText(/Checked/);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "only tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" })); await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0]).toMatchObject({ message: "only tomorrow", previous: { intent: "leads", query: "MM-101", area: "Miami" } });
    expect(state.ask.mock.calls[1][0].intent).toBeUndefined();
  });
  it("sends only AI conversation turns, never CRM cards, after consent", async () => {
    state.ask.mockResolvedValueOnce({ ...emptyCopilotResult("leads"), cards: [{ id: "00000000-0000-4000-8000-000000000001", title: "PRIVATE CUSTOMER", subtitle: "PRIVATE PHONE", href: "/leads/00000000-0000-4000-8000-000000000001", fields: [] }] }); panel();
    fireEvent.click(screen.getByRole("button", { name: "Find a lead" })); fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" })); await screen.findByText("PRIVATE CUSTOMER");
    fireEvent.change(screen.getByLabelText("Copilot mode"), { target: { value: "ask" } });
    fireEvent.click(screen.getByRole("switch", { name: "Allow AI-assisted mode" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "What is a heat pump?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Copilot question" })); await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(state.ask.mock.calls[1][0])).not.toContain("PRIVATE");
  });
  it("stops waiting without accepting a late result or automatically resubmitting", async () => {
    let resolve: (result: CopilotResult) => void;
    state.ask.mockImplementation(() => new Promise<CopilotResult>((done) => { resolve = done; })); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("may still complete");
    resolve!({ ...emptyCopilotResult("report"), text: "DISCARD LATE RESULT" });
    await waitFor(() => expect(screen.queryByText("DISCARD LATE RESULT")).not.toBeInTheDocument());
    expect(state.ask).toHaveBeenCalledTimes(1);
  });
  it("preserves the earlier report's exact dates and team scope for Explain", async () => {
    state.ask.mockResolvedValue({ ...emptyCopilotResult("report"), followup: { intent: "report", start: "2026-10-01", end: "2026-10-07", scope: "team" } }); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Explain with AI (uses allowance)" })); await waitFor(() => expect(state.ask).toHaveBeenCalledTimes(2));
    expect(state.ask.mock.calls[1][0]).toMatchObject({ intent: "explain_report", start: "2026-10-01", end: "2026-10-07", scope: "team", allowAi: true });
  });
  it("minimizes without clearing the answer, draft, filters or AI consent", async () => {
    state.ask.mockResolvedValue({ ...emptyCopilotResult("report"), text: "Saved session answer" }); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" })); await screen.findByText("Saved session answer");
    fireEvent.click(screen.getByRole("button", { name: "Expand Copilot" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow AI-assisted mode" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" }), { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Minimize Copilot" }));
    expect(screen.queryByRole("dialog", { name: "Marshmallow Copilot" })).not.toBeInTheDocument(); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore Marshmallow Copilot" }));
    expect(await screen.findByText("Saved session answer")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue("Keep my draft");
    expect(screen.getByRole("switch", { name: "Allow AI-assisted mode" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Collapse Copilot" })).toBeVisible(); expect(state.ask).toHaveBeenCalledTimes(1);
  });
  it("keeps an in-flight answer while minimized without resubmitting on restore", async () => {
    let resolve: (result: CopilotResult) => void;
    state.ask.mockImplementation(() => new Promise<CopilotResult>((done) => { resolve = done; })); panel();
    fireEvent.click(screen.getByRole("button", { name: "My daily report" }));
    const signal = state.ask.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Minimize Copilot" })); expect(signal.aborted).toBe(false);
    resolve!({ ...emptyCopilotResult("report"), text: "Completed while minimized" });
    await waitFor(() => expect(screen.queryByLabelText("Preparing answer")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Restore Marshmallow Copilot" }));
    expect(await screen.findByText("Completed while minimized")).toBeVisible(); expect(state.ask).toHaveBeenCalledTimes(1);
  });
  it("can close a minimized session instead of restoring it", () => {
    panel(); fireEvent.click(screen.getByRole("button", { name: "Minimize Copilot" }));
    fireEvent.click(screen.getByRole("button", { name: "Close minimized Copilot" })); expect(close).toHaveBeenCalledTimes(1);
  });
});
