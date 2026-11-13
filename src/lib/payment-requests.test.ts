import { describe, expect, it, vi, beforeEach } from "vitest";

// A tiny chainable Supabase query-builder stand-in, mirroring the pattern in
// cancellation-requests.test.ts. Non-terminal methods return the builder itself
// (awaiting a plain object with no `.then` just resolves to that object, so a
// destructured `error` comes out undefined == no error); terminal reads resolve
// with whatever the test configured.
const insertSpy = vi.fn();
const updateSpy = vi.fn();
let existingPending: unknown = null;
let insertError: { message: string } | null = null;
let reviewError: { message: string } | null = null;

function makeBuilder() {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = vi.fn(self);
  b.eq = vi.fn(self);
  b.order = vi.fn(self);
  b.limit = vi.fn(self);
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: existingPending, error: null }));
  b.single = vi.fn(() => Promise.resolve({ data: { id: "req-1" }, error: insertError }));
  b.insert = vi.fn((payload: unknown) => {
    insertSpy(payload);
    return b;
  });
  b.update = vi.fn((payload: unknown) => {
    updateSpy(payload);
    b.error = reviewError;
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

const { logActivitySpy, updateLeadByIdSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn(() => Promise.resolve()),
  updateLeadByIdSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/activity", () => ({ logActivity: logActivitySpy }));
vi.mock("@/lib/lead-updates", () => ({ updateLeadById: updateLeadByIdSpy }));
vi.mock("@/lib/image-upload", () => ({ optimizeImageForUpload: vi.fn((f: File) => Promise.resolve(f)) }));

import {
  canCreatePaymentRequest,
  canReviewPaymentRequest,
  createPaymentRequest,
  reviewPaymentRequest,
  PAYMENT_REQUEST_TYPE_LABELS,
  type LeadPaymentRequest,
} from "./payment-requests";

const lead = { id: "lead-1", job_id: "LD-1", customer_name: "Aaron", status: "job_done" } as never;

const baseArgs = {
  lead,
  userId: "user-1",
  userName: "Processor Pat",
  requesterRole: "processor" as const,
  amount: 100,
};

const baseRequest: LeadPaymentRequest = {
  id: "req-1",
  lead_id: "lead-1",
  previous_status: "job_done" as never,
  requested_by: "user-1",
  requested_by_name: "Processor Pat",
  requested_by_role: "processor",
  request_type: "paid",
  amount: 100,
  screenshot_path: null,
  comment: null,
  status: "pending",
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  created_at: "2026-11-14T00:00:00Z",
  updated_at: "2026-11-14T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  insertSpy.mockClear();
  updateSpy.mockClear();
  existingPending = null;
  insertError = null;
  reviewError = null;
});

describe("payment request role gates", () => {
  it("only Processors can create either request type", () => {
    expect(canCreatePaymentRequest("processor")).toBe(true);
    expect(canCreatePaymentRequest("admin")).toBe(false);
    expect(canCreatePaymentRequest("customer_service")).toBe(false);
    expect(canCreatePaymentRequest("opr")).toBe(false);
    expect(canCreatePaymentRequest(null)).toBe(false);
  });

  it("only Admin can review a pending request, of either type", () => {
    const pendingPaid = { ...baseRequest, request_type: "paid" as const };
    const pendingPartial = { ...baseRequest, request_type: "partial_paid" as const };
    expect(canReviewPaymentRequest("admin", pendingPaid)).toBe(true);
    expect(canReviewPaymentRequest("admin", pendingPartial)).toBe(true);
    expect(canReviewPaymentRequest("processor", pendingPaid)).toBe(false);
    expect(canReviewPaymentRequest("admin", { ...pendingPaid, status: "approved" })).toBe(false);
    expect(canReviewPaymentRequest("admin", null)).toBe(false);
  });
});

describe("createPaymentRequest", () => {
  it("does not move or audit a lead when the request insert fails", async () => {
    insertError = { message: "Request denied" };
    await expect(createPaymentRequest({ ...baseArgs, requestType: "partial_paid" })).rejects.toThrow("Request denied");
    expect(updateLeadByIdSpy).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });
  it("inserts a paid request and moves the lead to payment_requested", async () => {
    await createPaymentRequest({ ...baseArgs, requestType: "paid" });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.request_type).toBe("paid");
    expect(row.amount).toBe(100);
    expect(row.status).toBe("pending");
    expect(updateLeadByIdSpy).toHaveBeenCalledWith("lead-1", expect.objectContaining({ status: "payment_requested" }));
    expect(logActivitySpy).toHaveBeenCalledWith(
      "user-1", "payment_requested", "lead", "lead-1",
      expect.objectContaining({ request_type: "paid", amount: 100 }),
    );
  });

  it("inserts a partial_paid request the same way", async () => {
    await createPaymentRequest({ ...baseArgs, requestType: "partial_paid" });

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.request_type).toBe("partial_paid");
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(updateLeadByIdSpy).toHaveBeenCalledTimes(1);
    // Still lands in the shared pending queue, not a separate status.
    expect(updateLeadByIdSpy).toHaveBeenCalledWith("lead-1", expect.objectContaining({ status: "payment_requested" }));
  });

  it("refuses a non-Processor, naming the request type", async () => {
    await expect(
      createPaymentRequest({ ...baseArgs, requesterRole: "admin", requestType: "partial_paid" }),
    ).rejects.toThrow(/Partial Paid/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("requires a positive amount", async () => {
    await expect(createPaymentRequest({ ...baseArgs, requestType: "paid", amount: 0 })).rejects.toThrow(/required/i);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("refuses a second pending request of either type for the same lead", async () => {
    existingPending = { id: "already-open" };
    await expect(createPaymentRequest({ ...baseArgs, requestType: "partial_paid" })).rejects.toThrow(/pending payment request/i);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("reviewPaymentRequest", () => {
  it("does not apply an outcome when the review write is denied", async () => {
    reviewError = { message: "Review denied" };
    await expect(reviewPaymentRequest({ request: baseRequest, lead, reviewerId: "admin-1", reviewerRole: "admin", action: "approved" })).rejects.toThrow("Review denied");
    expect(updateLeadByIdSpy).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });
  it("approves a paid request to status 'paid'", async () => {
    await reviewPaymentRequest({
      request: { ...baseRequest, request_type: "paid" },
      lead,
      reviewerId: "admin-1",
      reviewerRole: "admin",
      action: "approved",
    });

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
    expect(updateLeadByIdSpy).toHaveBeenCalledWith("lead-1", expect.objectContaining({ status: "paid", amount: 100 }));
  });

  it("approves a partial_paid request to status 'partial_paid', never 'paid'", async () => {
    await reviewPaymentRequest({
      request: { ...baseRequest, request_type: "partial_paid" },
      lead,
      reviewerId: "admin-1",
      reviewerRole: "admin",
      action: "approved",
    });

    expect(updateLeadByIdSpy).toHaveBeenCalledWith("lead-1", expect.objectContaining({ status: "partial_paid", amount: 100 }));
  });

  it("rejects a request back to its previous status, regardless of type", async () => {
    await reviewPaymentRequest({
      request: { ...baseRequest, request_type: "partial_paid", previous_status: "job_done" as never },
      lead,
      reviewerId: "admin-1",
      reviewerRole: "admin",
      action: "rejected",
    });

    expect(updateLeadByIdSpy).toHaveBeenCalledWith("lead-1", expect.objectContaining({ status: "job_done" }));
  });

  it("refuses a non-Admin reviewer, naming the request type", async () => {
    await expect(
      reviewPaymentRequest({
        request: { ...baseRequest, request_type: "partial_paid" },
        lead,
        reviewerId: "proc-1",
        reviewerRole: "processor",
        action: "approved",
      }),
    ).rejects.toThrow(/Partial Paid/);
    expect(updateLeadByIdSpy).not.toHaveBeenCalled();
  });
});

describe("PAYMENT_REQUEST_TYPE_LABELS", () => {
  it("has a human label for both request types", () => {
    expect(PAYMENT_REQUEST_TYPE_LABELS.paid).toBe("Paid");
    expect(PAYMENT_REQUEST_TYPE_LABELS.partial_paid).toBe("Partial Paid");
  });
});
