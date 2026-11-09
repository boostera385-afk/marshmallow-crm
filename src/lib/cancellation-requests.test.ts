import { describe, expect, it, vi, beforeEach } from "vitest";

// A tiny chainable Supabase query-builder stand-in. Every chain method returns
// the builder; the terminal methods resolve with whatever the test configured.
// `insertSpy` captures the row that createCancellationRequest tries to write so
// we can assert on the AI audit columns.
const insertSpy = vi.fn();
let existingPending: unknown = null; // the "one pending request per lead" guard

function makeBuilder() {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = vi.fn(self);
  b.eq = vi.fn(self);
  b.order = vi.fn(self);
  b.limit = vi.fn(self);
  b.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: existingPending, error: null }));
  b.single = vi.fn(() => Promise.resolve({ data: { id: "req-1" }, error: null }));
  b.insert = vi.fn((payload: unknown) => {
    insertSpy(payload);
    return b;
  });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    storage: { from: vi.fn(() => ({ upload: vi.fn(() => Promise.resolve({ error: null })) })) },
  },
}));

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/lead-updates", () => ({ updateLeadById: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/image-upload", () => ({ optimizeImageForUpload: vi.fn((f: File) => Promise.resolve(f)) }));

import {
  createCancellationRequest,
  canCreateCancellationRequest,
  canReviewCancellationRequest,
  getCancellationApproverRoles,
} from "./cancellation-requests";
import { CANCELLATION_REASON_CODES } from "./cancellation-reasons";

const lead = { id: "lead-1", status: "need_tech", customer_name: "Aaron", job_id: "LD-1" } as never;

const baseArgs = {
  lead,
  userId: "user-1",
  userName: "CS Rep",
  requesterRole: "customer_service" as const,
  comment: "Customer no longer wants the job",
  proof: null,
  proofImage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  insertSpy.mockClear();
  existingPending = null;
});

describe("createCancellationRequest — AI audit trail", () => {
  it("persists the AI reason code, explanation, applied flag and timestamp when a suggestion was applied", async () => {
    await createCancellationRequest({
      ...baseArgs,
      aiReasonCode: "Customer Declined Quote",
      aiReasonApplied: true,
      aiSuggestedReason: "The customer said the price was too high in chat.",
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.ai_reason_code).toBe("Customer Declined Quote");
    expect(row.ai_reason_applied).toBe(true);
    expect(row.ai_suggested_reason).toBe("The customer said the price was too high in chat.");
    expect(typeof row.ai_suggested_at).toBe("string"); // set because a reason code was present
  });

  it("records no AI application when staff did not apply a suggestion (human-in-the-loop)", async () => {
    await createCancellationRequest({ ...baseArgs });

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.ai_reason_code).toBeNull();
    expect(row.ai_reason_applied).toBe(false);
    expect(row.ai_suggested_reason).toBeNull();
    expect(row.ai_suggested_at).toBeNull();
  });

  it("refuses a second pending request for the same lead", async () => {
    existingPending = { id: "already-open" };
    await expect(createCancellationRequest({ ...baseArgs })).rejects.toThrow(/already has a pending/i);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("requires a non-empty comment", async () => {
    await expect(createCancellationRequest({ ...baseArgs, comment: "   " })).rejects.toThrow(/required/i);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("cancellation role gates", () => {
  it("lets CS, CS Admin and Processor create requests, but not admin or read-only roles", () => {
    expect(canCreateCancellationRequest("customer_service")).toBe(true);
    expect(canCreateCancellationRequest("cs_admin")).toBe(true);
    expect(canCreateCancellationRequest("processor")).toBe(true);
    expect(canCreateCancellationRequest("admin")).toBe(false);
    expect(canCreateCancellationRequest("opr")).toBe(false);
    expect(canCreateCancellationRequest(null)).toBe(false);
  });

  it("only lets admin, or a processor reviewing a CS request, approve a pending request", () => {
    const fromCs = { status: "pending", requested_by_role: "customer_service" } as never;
    const fromProcessor = { status: "pending", requested_by_role: "processor" } as never;
    expect(canReviewCancellationRequest("admin", fromCs)).toBe(true);
    expect(canReviewCancellationRequest("processor", fromCs)).toBe(true);
    expect(canReviewCancellationRequest("processor", fromProcessor)).toBe(false);
    expect(canReviewCancellationRequest("customer_service", fromCs)).toBe(false);
    // A non-pending request is never reviewable.
    expect(canReviewCancellationRequest("admin", { status: "approved", requested_by_role: "customer_service" } as never)).toBe(false);
  });

  it("routes approvals to admin for processor requests, and admin+processor otherwise", () => {
    expect(getCancellationApproverRoles("processor")).toEqual(["admin"]);
    expect(getCancellationApproverRoles("customer_service")).toEqual(["admin", "processor"]);
    expect(getCancellationApproverRoles("cs_admin")).toEqual(["admin", "processor"]);
  });
});

describe("shared cancellation reason list", () => {
  it("mirrors the edge function's valid-reason vocabulary", () => {
    expect(CANCELLATION_REASON_CODES).toContain("Customer Declined Quote");
    expect(CANCELLATION_REASON_CODES).toContain("Other");
    expect(CANCELLATION_REASON_CODES).toHaveLength(8);
  });
});
