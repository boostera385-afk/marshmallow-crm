import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ error: null as null | { message: string }, update: vi.fn(), eq: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: (patch: unknown) => { db.update(patch); return { eq: (...args: unknown[]) => { db.eq(...args); return Promise.resolve({ error: db.error }); } }; } }) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";
import {
  customerSaidFromAlert, isNewScheduleAlert, onScheduleRequirementPrompt, onScheduleRequirementSaved, promptsForNewSchedule,
  requestScheduleRequirementPrompt, saveScheduleRequirement,
} from "./schedule-requirement";

afterEach(() => { db.error = null; vi.clearAllMocks(); });

describe("new schedule prompt rules", () => {
  it("prompts only when the tag becomes Customer Require New Schedule", () => {
    expect(promptsForNewSchedule("waiting_schedule_confirmation", "confirmation_sent")).toBe(true);
    expect(promptsForNewSchedule(null, "confirmation_sent")).toBe(true);
    expect(promptsForNewSchedule("confirmation_sent", "confirmation_sent")).toBe(false);
    for (const tag of ["ready_to_schedule", "waiting_schedule_confirmation", "booked", null]) expect(promptsForNewSchedule("confirmation_sent", tag)).toBe(false);
  });
  it("recognises the AI alert in both server shapes and reads the customer's words", () => {
    expect(isNewScheduleAlert({ event_type: "schedule_ready", event_kind: "schedule_new_needed" })).toBe(true);
    expect(isNewScheduleAlert({ event_type: "schedule_new_needed" })).toBe(true);
    expect(isNewScheduleAlert({ event_type: "schedule_ready", event_kind: "schedule_ready" })).toBe(false);
    expect(customerSaidFromAlert('Job ID: SYN-1\nCustomer said: "How about the 14th?"\nTag changed by AI: x')).toBe("How about the 14th?");
    expect(customerSaidFromAlert("Job ID: SYN-1")).toBeNull();
  });
  it("delivers prompt requests to listeners", () => {
    const listener = vi.fn();
    const stop = onScheduleRequirementPrompt(listener);
    requestScheduleRequirementPrompt({ key: "k", source: "manual", leadId: "lead-1" });
    stop();
    requestScheduleRequirementPrompt({ key: "k2", source: "manual", leadId: "lead-1" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ key: "k", source: "manual", leadId: "lead-1" });
  });
});

describe("saving the schedule requirement", () => {
  it("saves the trimmed value with the editor and tells open pages", async () => {
    const saved = vi.fn();
    const stop = onScheduleRequirementSaved(saved);
    expect(await saveScheduleRequirement({ leadId: "lead-1", value: "  Sat 11/14 9am-11am ", editor: { id: "u1", name: "Sam CS" } }))
      .toEqual({ ok: true, value: "Sat 11/14 9am-11am" });
    stop();
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ customer_schedule_requirements: "Sat 11/14 9am-11am", last_edited_by: "u1", last_edited_by_name: "Sam CS" }));
    expect(db.eq).toHaveBeenCalledWith("id", "lead-1");
    expect(saved).toHaveBeenCalledWith({ leadId: "lead-1", value: "Sat 11/14 9am-11am" });
    expect(toast.success).toHaveBeenCalledWith("Schedule requirement updated");
  });
  it("reports a failed save and does not announce it", async () => {
    db.error = { message: "denied" };
    const saved = vi.fn();
    const stop = onScheduleRequirementSaved(saved);
    expect((await saveScheduleRequirement({ leadId: "lead-1", value: "x", editor: { name: "Sam" } })).ok).toBe(false);
    stop();
    expect(saved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Failed to update schedule requirement");
  });
});
