import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Lead } from "@/types";

const state = vi.hoisted(() => ({ role: "customer_service", save: vi.fn(), prompt: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "cs-1" }, role: state.role, profile: { full_name: "Sam CS" } }) }));
vi.mock("@/lib/lead-tag-actions", () => ({ saveLeadTag: state.save }));
vi.mock("@/lib/schedule-requirement", async () => ({ ...(await vi.importActual<object>("@/lib/schedule-requirement")), requestScheduleRequirementPrompt: state.prompt }));
// A native select stands in for the Radix one, which jsdom cannot open.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) =>
    <select aria-label="Lead tag" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
import LeadTagControl from "./LeadTagControl";

const lead = { id: "lead-1", customer_name: "Jane Sample", cs_tag: "waiting_schedule_confirmation", created_by: "cs-1" } as unknown as Lead;
beforeEach(() => { state.role = "customer_service"; state.save.mockReset().mockResolvedValue({ ok: true, patch: {} }); state.prompt.mockReset(); });
afterEach(cleanup);

it("asks for the new schedule requirement right after Customer Require New Schedule is saved", async () => {
  const onSaved = vi.fn();
  render(<LeadTagControl lead={lead} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("Lead tag"), { target: { value: "confirmation_sent" } });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ cs_tag: "confirmation_sent" })));
  expect(state.prompt).toHaveBeenCalledOnce();
  expect(state.prompt).toHaveBeenCalledWith(expect.objectContaining({ source: "manual", leadId: "lead-1", customerName: "Jane Sample" }));
  // Only this person's screen: the tag save sends no alert or notification to anyone else.
  expect(state.save).toHaveBeenCalledOnce();
});

it("does not prompt for other tags, or when the tag save fails", async () => {
  render(<LeadTagControl lead={lead} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Lead tag"), { target: { value: "ready_to_schedule" } });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  state.save.mockResolvedValue({ ok: false, patch: {} });
  fireEvent.change(screen.getByLabelText("Lead tag"), { target: { value: "confirmation_sent" } });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(state.prompt).not.toHaveBeenCalled();
});

it("does not prompt again when the lead already has the tag", async () => {
  render(<LeadTagControl lead={{ ...lead, cs_tag: "confirmation_sent" } as Lead} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Lead tag"), { target: { value: "__clear__" } });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.prompt).not.toHaveBeenCalled();
});
