import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
  return render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopilotPanel access={permissions} onClose={close}/></MemoryRouter></QueryClientProvider>);
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
});
