import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "customer_service", user: { id: "cs-1", email: "cs@example.invalid" },
  lead: null as null | Record<string, unknown>, filters: [] as Array<[string, unknown]>, save: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, role: state.role, profile: { full_name: "Sam CS" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: (column: string, value: unknown) => { state.filters.push([column, value]); return { maybeSingle: () => Promise.resolve({ data: state.lead }) }; } }) }) },
}));
vi.mock("./MultiDateTimePicker", () => ({ default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
  <textarea aria-label="Schedule requirement" value={value} onChange={(e) => onChange(e.target.value)} /> }));
vi.mock("@/lib/schedule-requirement", async () => {
  const actual = await vi.importActual<typeof import("@/lib/schedule-requirement")>("@/lib/schedule-requirement");
  return { ...actual, saveScheduleRequirement: state.save };
});
import { requestScheduleRequirementPrompt } from "@/lib/schedule-requirement";
import ScheduleRequirementPrompt from "./ScheduleRequirementPrompt";

const lead = { id: "lead-1", job_id: "LD-SYN1", customer_name: "Jane Sample", customer_schedule_requirements: "Fri 11/13 9am-11am", created_by: "cs-1", assigned_cs: null };
beforeEach(() => {
  state.role = "customer_service"; state.lead = { ...lead }; state.filters = [];
  state.save.mockReset().mockResolvedValue({ ok: true, value: "Sat 11/14 1pm-3pm" });
});
afterEach(cleanup);

it("AI alert: opens for the CS who created the lead, with the customer's words, starting from the saved requirement, and saves", async () => {
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "alert:n1", source: "ai", jobId: "LD-SYN1", customerSaid: "How about the 14th?" }));
  expect(await screen.findByText("Customer requires a new schedule")).toBeInTheDocument();
  expect(state.filters).toEqual([["job_id", "LD-SYN1"]]);
  expect(screen.getByText("Customer said: “How about the 14th?”")).toBeInTheDocument();
  expect(screen.getByText(/Jane Sample · LD-SYN1 needs a new schedule/)).toBeInTheDocument();
  const picker = screen.getByLabelText("Schedule requirement");
  expect(picker).toHaveValue("Fri 11/13 9am-11am");
  fireEvent.change(picker, { target: { value: "Sat 11/14 1pm-3pm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith({ leadId: "lead-1", value: "Sat 11/14 1pm-3pm", editor: { id: "cs-1", name: "Sam CS" } }));
  await waitFor(() => expect(screen.queryByText("Customer requires a new schedule")).toBeNull());
});

it.each([
  ["assigned to the lead but did not create it", { created_by: "creator-cs", assigned_cs: "cs-1" }],
  ["only shared or unrelated", { created_by: "creator-cs", assigned_cs: "another-cs" }],
])("AI alert: does not open for a CS who is %s", async (_label, owner) => {
  state.lead = { ...lead, ...owner };
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "a", source: "ai", jobId: "LD-SYN1" }));
  await waitFor(() => expect(state.filters).toHaveLength(1));
  expect(screen.queryByText("Customer requires a new schedule")).toBeNull();
});

it("AI alert: does not open when the lead cannot be read", async () => {
  state.lead = null;
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "b", source: "ai", jobId: "LD-SYN1" }));
  await waitFor(() => expect(state.filters).toHaveLength(1));
  expect(screen.queryByText("Customer requires a new schedule")).toBeNull();
});

it("AI alert: opens for a CS Admin on any lead they can read", async () => {
  state.role = "cs_admin"; state.lead = { ...lead, created_by: "someone-else" };
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "a", source: "ai", jobId: "LD-SYN1" }));
  expect(await screen.findByText("Customer requires a new schedule")).toBeInTheDocument();
});

it("Manual tag: opens for the person who set it, even if they did not create the lead", async () => {
  state.lead = { ...lead, created_by: "creator-cs", assigned_cs: "cs-1" };
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "tag:lead-1:1", source: "manual", leadId: "lead-1" }));
  expect(await screen.findByText("Customer requires a new schedule")).toBeInTheDocument();
  expect(screen.queryByText(/Customer said/)).toBeNull();
});

it("shows each request once and closes with Later without saving", async () => {
  render(<ScheduleRequirementPrompt />);
  act(() => { requestScheduleRequirementPrompt({ key: "tag:lead-1:1", source: "manual", leadId: "lead-1" }); requestScheduleRequirementPrompt({ key: "tag:lead-1:1", source: "manual", leadId: "lead-1" }); });
  expect(await screen.findByText("Customer requires a new schedule")).toBeInTheDocument();
  expect(state.filters).toEqual([["id", "lead-1"]]);
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  await waitFor(() => expect(screen.queryByText("Customer requires a new schedule")).toBeNull());
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps the prompt open and unsaved when the save fails", async () => {
  state.save.mockResolvedValue({ ok: false, value: "x" });
  render(<ScheduleRequirementPrompt />);
  act(() => requestScheduleRequirementPrompt({ key: "k", source: "manual", leadId: "lead-1" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(screen.getByText("Customer requires a new schedule")).toBeInTheDocument();
});
