import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWorkflowAlerts, INBOX_RETRY_DELAY_MS, workflowCall } from "./workflow-inbox";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

type InvokeResult = { data: unknown; error: unknown };
const ok = (data: unknown): InvokeResult => ({ data, error: null });
const httpError = (status: number, body: unknown): InvokeResult => {
  const error = new Error(`Edge function returned a non-2xx status code: ${status}`) as Error & { context: Response };
  error.context = new Response(JSON.stringify(body), { status });
  return { data: null, error };
};
const page = { rows: [], total: 1, unread_count: 0 };

beforeEach(() => { mocks.invoke.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("workflow inbox degraded-runtime recovery", () => {
  it("retries a degraded edge runtime once and succeeds without user action", async () => {
    mocks.invoke.mockImplementation(() => mocks.invoke.mock.calls.length === 1
      ? Promise.resolve(httpError(503, { code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED", message: "Service is temporarily unavailable" }))
      : Promise.resolve(ok(page)));
    const pending = fetchWorkflowAlerts("2026-10-23T00:00:00Z", "2026-10-23T01:00:00Z", 0);
    await vi.advanceTimersByTimeAsync(INBOX_RETRY_DELAY_MS);
    await expect(pending).resolves.toEqual(page);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("stops after the single retry when the runtime stays degraded", async () => {
    mocks.invoke.mockResolvedValue(httpError(503, { code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED", message: "Service is temporarily unavailable" }));
    const pending = workflowCall("notifications", { action: "list", view: "all", category: "all", search: "", offset: 0 });
    const expectation = expect(pending).rejects.toThrow("Notification service briefly restarted");
    await vi.advanceTimersByTimeAsync(INBOX_RETRY_DELAY_MS);
    await expectation;
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("surfaces validation errors immediately without retrying", async () => {
    mocks.invoke.mockResolvedValue(httpError(400, { error: "Invalid request" }));
    await expect(workflowCall("notifications", { action: "read", ids: [] })).rejects.toThrow("Invalid request");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps app-authored permission and availability errors as-is", async () => {
    mocks.invoke.mockResolvedValue(httpError(403, { error: "You do not have access to this inbox." }));
    await expect(workflowCall("notifications", { action: "list", view: "all", category: "all", search: "", offset: 0 }))
      .rejects.toThrow("You do not have access to this inbox.");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
