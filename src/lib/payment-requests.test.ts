import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadPaymentRequest } from "./payment-requests";
import {
  canCreatePaymentRequest, canReviewPaymentRequest, createPaymentRequest,
  paymentRequestTypeTagClass, PAYMENT_REQUEST_TYPE_LABELS, recordDirectPayment,
  reviewPaymentRequest, shouldOfferPaymentTypeChoice,
} from "./payment-requests";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } },
}));
vi.mock("@/lib/image-upload", () => ({ optimizeImageForUpload: async (file: File) => file }));

const ID = "00000000-0000-4000-8000-000000000001";
const OP = "00000000-0000-4000-8000-000000000002";
const lead = { id: ID, job_id: "MM-1", customer_name: "Synthetic", status: "job_done" } as never;
const args = { lead, userId: ID, requesterRole: "processor" as const, amount: 25.5, operationId: OP };
const request: LeadPaymentRequest = {
  id: ID, lead_id: ID, previous_status: "job_done", requested_by: ID, requested_by_role: "processor",
  request_type: "paid", amount: 25.5, screenshot_path: null, comment: null, status: "pending",
  reviewed_by: null, reviewed_at: null, review_note: null, created_at: "", updated_at: "",
};
const review = { request, lead, reviewerId: ID, reviewerRole: "admin" as const, action: "approved" as const, operationId: OP };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { saved: true, id: ID, status: "payment_requested" }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
});

describe("payment permissions and presentation", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin", null] as const)(
    "preserves independent request and review gates for %s", (role) => {
      expect(canCreatePaymentRequest(role)).toBe(role === "processor");
      expect(canReviewPaymentRequest(role, request)).toBe(role === "admin");
      expect(canReviewPaymentRequest(role, { ...request, status: "approved" })).toBe(false);
    },
  );
  it("offers Admin both outcomes even for an already Partial Paid lead, never a Paid lead", () => {
    for (const previous of ["job_done", "partial_paid", "payment_pending"] as const) {
      expect(shouldOfferPaymentTypeChoice("admin", "paid", previous)).toBe(true);
    }
    expect(shouldOfferPaymentTypeChoice("admin", "paid", "paid")).toBe(false);
    expect(shouldOfferPaymentTypeChoice("processor", "paid", "job_done")).toBe(false);
    expect(shouldOfferPaymentTypeChoice(null, "paid", "job_done")).toBe(false);
    expect(shouldOfferPaymentTypeChoice("admin", "partial_paid", "job_done")).toBe(false);
  });
  it("keeps Partial Paid yellow and Paid/legacy green with distinct labels", () => {
    expect(paymentRequestTypeTagClass("partial_paid")).toContain("yellow");
    expect(paymentRequestTypeTagClass("partial_paid")).not.toContain("emerald");
    expect(paymentRequestTypeTagClass("paid")).toContain("emerald");
    expect(paymentRequestTypeTagClass(null)).toBe(paymentRequestTypeTagClass("paid"));
    expect(PAYMENT_REQUEST_TYPE_LABELS).toEqual({ paid: "Paid", partial_paid: "Partial Paid" });
  });
});

describe("atomic payment transport", () => {
  it.each(["paid", "partial_paid"] as const)("creates %s using exactly one RPC and no client writes", async (requestType) => {
    const result = await createPaymentRequest({ ...args, requestType, comment: "  Deposit  " });
    expect(result.saved).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("workflow_requests", { p_input: {
      kind: "payment", action: "create", leadId: ID, operationId: OP, expectedStatus: "job_done",
      requestType, amount: 25.5, screenshotPath: null, comment: "Deposit",
    } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([0, -1, Infinity, NaN, 1.001])("rejects invalid amount %s before uploads or RPCs", async (amount) => {
    await expect(createPaymentRequest({ ...args, amount, requestType: "paid" })).rejects.toThrow(/positive/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects a non-Processor request before contacting the backend", async () => {
    await expect(createPaymentRequest({ ...args, requesterRole: "admin", requestType: "partial_paid" })).rejects.toThrow(/Processors/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["Request denied", "This lead already has a pending payment request"])("surfaces server rejection: %s", async (message) => {
    mocks.rpc.mockResolvedValue({ error: { message }, data: null });
    await expect(createPaymentRequest({ ...args, requestType: "paid" })).rejects.toThrow(message);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["paid", "partial_paid"] as const)("records direct %s with the same authenticated authority", async (requestType) => {
    await recordDirectPayment({ ...args, requesterRole: "admin", requestType });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("workflow_requests", { p_input: expect.objectContaining({
      action: "direct", requestType, expectedStatus: "job_done", operationId: OP,
    }) });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not give a Processor a direct-payment bypass", async () => {
    await expect(recordDirectPayment({ ...args, requestType: "paid" })).rejects.toThrow(/Admins/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["approved", "rejected"] as const)("reviews %s without trusting browser amount, previous status or requested outcome", async (action) => {
    await reviewPaymentRequest({ ...review, action, request: { ...request, request_type: "partial_paid", amount: 999 }, reviewNote: " Checked " });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("workflow_requests", { p_input: {
      kind: "payment", action: "review", operationId: OP, leadId: ID, requestId: ID, decision: action, comment: "Checked",
    } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("surfaces a denied or concurrently reviewed request without an independent lead update", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Already reviewed" } });
    await expect(reviewPaymentRequest(review)).rejects.toThrow("Already reviewed");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("shows the backend's non-retryable PT409 stale-status conflict once, with no retry or client write", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: {
      code: "PT409", message: "Lead status changed. Refresh before recording payment.",
    } });
    await expect(recordDirectPayment({ ...args, requesterRole: "admin", requestType: "paid" }))
      .rejects.toThrow("Lead status changed. Refresh before recording payment.");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1].p_input).toMatchObject({ action: "direct", expectedStatus: "job_done" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("refuses non-Admin and already-reviewed requests", async () => {
    await expect(reviewPaymentRequest({ ...review, reviewerRole: "processor" })).rejects.toThrow(/Admins/);
    await expect(reviewPaymentRequest({ ...review, request: { ...request, status: "approved" } })).rejects.toThrow(/Admins/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], { saved: true }, { saved: false, id: ID, status: "paid" }])(
    "never reports success without a valid saved-row acknowledgement: %j", async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(recordDirectPayment({ ...args, requesterRole: "admin", requestType: "paid" })).rejects.toThrow(/acknowledgement/);
    },
  );
  it("retries the same operation ID and payload after an uncertain response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Connection lost" } });
    const input = { ...args, requestType: "paid" as const };
    await expect(createPaymentRequest(input)).rejects.toThrow("Connection lost");
    await createPaymentRequest(input);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
});

describe("payment evidence", () => {
  it.each(["create", "direct"] as const)("%s never submits a payment after upload failure, and can retry", async (action) => {
    const screenshotFile = new File(["proof"], "proof.png", { type: "image/png" });
    const input = { ...args, requestType: "partial_paid" as const, screenshotFile };
    const save = () => action === "create" ? createPaymentRequest(input) : recordDirectPayment({ ...input, requesterRole: "admin" });
    mocks.upload.mockResolvedValueOnce({ error: { message: "Denied" } });
    await expect(save()).rejects.toThrow(/screenshot upload failed/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await save();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });
  it("deduplicates evidence uploads for uncertain/concurrent retries and keeps the saved path", async () => {
    const input = { ...args, requestType: "paid" as const, screenshotFile: new File(["proof"], "proof.png") };
    await Promise.all([createPaymentRequest(input), createPaymentRequest(input)]);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const path = mocks.upload.mock.calls[0][0];
    expect(path).toMatch(new RegExp(`^payment-requests/${ID}/${ID}/${OP}/`));
    expect(mocks.rpc.mock.calls[0][1].p_input.screenshotPath).toBe(path);
    expect(mocks.rpc.mock.calls[1][1].p_input.screenshotPath).toBe(path);
  });
});
