import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LeadTechContact } from "@/lib/tech-status";

const state = vi.hoisted(() => ({
  role: "processor" as string,
  techs: [] as LeadTechContact[],
  setMutate: vi.fn(),
  checkMutate: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, role: state.role }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useLeadTechContacts", () => ({
  canSeeTechTracking: (role: string) => role === "admin" || role === "processor",
  useLeadTechContacts: () => ({ data: state.techs, isLoading: false, isError: false }),
  useSetTechContactState: () => ({ mutate: state.setMutate, isPending: false }),
  useCheckTechStatus: () => ({ mutate: state.checkMutate, isPending: false }),
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

  it("is hidden from roles other than Admin and Processor", () => {
    state.role = "cs_admin";
    const { container } = render(<TechTrackingPanel leadId="l1" />);
    expect(container).toBeEmptyDOMElement();
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

  it("shows the processor's remark and where the AI's quote came from", () => {
    state.techs = [tech({ state: "texted", state_source: "note", verdict: "declined", verdict_reason: "Out of area",
      evidence_quote: "ooa", evidence_source: "processor_note", processor_note: "ooa" })];
    render(<TechTrackingPanel leadId="l1" />);
    expect(screen.getByText("No tech in area")).toBeInTheDocument();
    expect(screen.getByText(/\(processor note\)/)).toBeInTheDocument();
    expect(screen.getByText(/From the note/)).toBeInTheDocument();
  });
});
