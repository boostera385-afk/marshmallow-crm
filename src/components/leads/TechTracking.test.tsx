import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LeadTechContact } from "@/lib/tech-status";

const state = vi.hoisted(() => ({
  role: "processor" as string,
  // Feature Access "tech_status" switch (role default resolved by canAccess in the app).
  granted: true,
  techs: [] as LeadTechContact[],
  setMutate: vi.fn(),
  checkMutate: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, role: state.role, canAccess: (item: string) => item === "tech_status" && state.granted }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useLeadTechContacts", () => ({
  canSeeTechStatus: (role: string, canAccess: (item: string) => boolean) => role === "admin" || canAccess("tech_status"),
  canEditTechTracking: (role: string) => role === "admin" || role === "processor",
  useLeadTechContacts: () => ({ data: state.techs, isLoading: false, isError: false }),
  useSetTechContactState: () => ({ mutate: state.setMutate, isPending: false }),
  useCheckTechStatus: () => ({ mutate: state.checkMutate, isPending: false }),
  useLeadTechChat: (_leadId: string, techNumber: number | null) => ({
    data: techNumber === null ? undefined : [
      { id: "m1", sender: "agent", kind: "text", text: "Can you take the Irving job tomorrow?", message_time: "2026-11-27T10:00:00Z", has_media: false },
      { id: "m2", sender: "customer", kind: "text", text: "Yes I can do it", message_time: "2026-11-27T10:05:00Z", has_media: false },
    ],
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  }),
}));

import { TechTrackingPanel } from "./TechTracking";

const tech = (over: Partial<LeadTechContact>): LeadTechContact => ({
  id: "t1", lead_id: "l1", tech_number: 1, name: "Michael", phone: "(305) 555-0123", state: "not_texted",
  contacted_at: null, verdict: null, verdict_reason: null, evidence_quote: null, evidence_at: null, evidence_source: null, processor_note: null, state_source: null,
  verdict_checked_at: null, ...over,
});

describe("TechTrackingPanel", () => {
  beforeEach(() => {
    state.role = "processor";
    state.granted = true;
    state.techs = [];
    state.setMutate.mockReset();
    state.checkMutate.mockReset();
  });

  it("shows No Tech Added with guidance when the job has no techs", () => {
    render(<TechTrackingPanel leadId="l1" />);
    expect(screen.getByText("No Tech Added")).toBeInTheDocument();
    expect(screen.getByText(/mark each one Texted or Called/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-check/ })).toBeDisabled();
  });

  it("is hidden from users without AI Tech Status in Feature Access", () => {
    state.role = "customer_service";
    state.granted = false;
    const { container } = render(<TechTrackingPanel leadId="l1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden from a Processor whose AI Tech Status was switched off", () => {
    state.granted = false;
    const { container } = render(<TechTrackingPanel leadId="l1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a granted user the status, but only Admin / Processor can change Texted / Called", () => {
    state.role = "customer_service";
    state.techs = [tech({ state: "texted", verdict: "pending" })];
    render(<TechTrackingPanel leadId="l1" />);
    expect(screen.getByText("Waiting on 1 tech")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Called" })).toBeDisabled();
  });

  it("summarises agreed techs and shows the tech's own words", () => {
    state.techs = [
      tech({ state: "texted", verdict: "agreed", verdict_reason: "Confirmed time and price", evidence_quote: "Yes I can do it" }),
      tech({ id: "t2", tech_number: 2, name: "David", state: "called", verdict: "agreed" }),
    ];
    render(<TechTrackingPanel leadId="l1" />);
    expect(screen.getByText("Michael, David agreed")).toBeInTheDocument();
    expect(screen.getByText("“Yes I can do it”")).toBeInTheDocument();
  });

  it("marks a tech Texted, then starts the AI check after the save", () => {
    state.techs = [tech({})];
    state.setMutate.mockImplementation((_vars, options) => options.onSuccess());
    render(<TechTrackingPanel leadId="l1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Texted" }));
    expect(state.setMutate).toHaveBeenCalledWith({ techNumber: 1, state: "texted" }, expect.any(Object));
    return waitFor(() => expect(state.checkMutate).toHaveBeenCalledWith({ leadIds: ["l1"] }, expect.any(Object)));
  });

  it("does not run the AI check when a tech goes back to Not Texted", () => {
    state.techs = [tech({ state: "texted", verdict: "pending" })];
    state.setMutate.mockImplementation((_vars, options) => options.onSuccess());
    render(<TechTrackingPanel leadId="l1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Not Texted" }));
    expect(state.setMutate).toHaveBeenCalledWith({ techNumber: 1, state: "not_texted" }, expect.any(Object));
    expect(state.checkMutate).not.toHaveBeenCalled();
  });

  it("opens the tech's chat when the Texted they already have is clicked", () => {
    state.techs = [tech({ state: "texted", verdict: "agreed", evidence_quote: "Yes I can do it" })];
    render(<TechTrackingPanel leadId="l1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Texted" }));
    expect(state.setMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Chat with Michael/ })).toBeInTheDocument();
    expect(screen.getByText("Can you take the Irving job tomorrow?")).toBeInTheDocument();
    expect(screen.getByText("The AI read this message")).toBeInTheDocument();
  });

  it("lets a granted user open the chat with the Chat button", () => {
    state.role = "customer_service";
    state.techs = [tech({ state: "texted", verdict: "pending" })];
    render(<TechTrackingPanel leadId="l1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Tech 1, Michael" }));
    expect(screen.getByText("Yes I can do it")).toBeInTheDocument();
  });

  it("shows the processor's remark and where the AI's quote came from", () => {
    state.techs = [tech({ state: "texted", state_source: "note", verdict: "declined", verdict_reason: "Out of area",
      evidence_quote: "ooa", evidence_source: "processor_note", processor_note: "ooa" })];
    render(<TechTrackingPanel leadId="l1" />);
    expect(screen.getByText("No tech in area")).toBeInTheDocument();
    expect(screen.getByText(/\(processor note\)/)).toBeInTheDocument();
    expect(screen.getByText(/From the note/)).toBeInTheDocument();
  });
});
