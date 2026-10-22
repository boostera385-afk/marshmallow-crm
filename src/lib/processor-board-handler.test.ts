// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createProcessorBoardHandler } from "../../supabase/functions/_shared/processor-board-handler";

const ID = "00000000-0000-4000-8000-000000000001";
const job = { id: ID, job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-01T00:00:00Z" };
function setup(options: { role?: string; signedIn?: boolean; visible?: boolean; hidden?: boolean; failSave?: boolean; failMessages?: boolean; busy?: boolean; aiFail?: boolean; noDirect?: boolean; directFail?: boolean; failRelease?: boolean; modelEvidence?: unknown[] } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    user_roles: [{ role: options.role ?? "processor" }], leads: options.hidden ? [] : [job],
    technicians: [{ id: "tech", phone_number: "4155550199", chat_link: "https://my.quo.com/inbox/PN12345678/c/CN12345678" }],
    quo_conversations: [{ id: "mirror", customer_number: "+14155550199", last_message_time: "2026-10-15T16:00:00Z" }],
    quo_messages: [{ id: "m1", conversation_id: "mirror", sender: "customer", text: "JOB-1001 is completed and ready for payment.", message_time: "2026-10-15T16:00:00Z" }],
    processor_job_assessments: [],
  };
  const reads: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "processor_can_view_status") return { data: options.visible !== false, error: null };
    if (name === "claim_processor_job_refresh") return { data: !options.busy, error: null };
    if (name === "save_processor_job_assessment") {
      if (!options.failSave) tables.processor_job_assessments = [{ input_hash: args.p_hash, result: args.p_result, checked_at: "2026-10-15T18:00:00Z" }];
      return { data: !options.failSave, error: null };
    }
    return { data: { rows: [], total: 0, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" }, error: null };
  });
  const from = (name: string) => {
    reads.push(name);
    let single = false;
    let low = 0; let high = Infinity;
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder, ilike: () => builder, order: () => builder,
      gte: () => builder, lte: () => builder, delete: vi.fn(() => builder),
      maybeSingle: () => { single = true; return builder; }, range: (a: number, b: number) => { low = a; high = b; return builder; },
      then: (resolve: (v: unknown) => unknown, reject?: (reason: unknown) => unknown) => (name === "processor_job_refresh_locks" && options.failRelease
        ? Promise.reject(new Error("Synthetic lease cleanup failure"))
        : Promise.resolve({ data: single ? tables[name]?.[0] ?? null : (tables[name] ?? []).slice(low, high + 1), error: name === "quo_messages" && options.failMessages ? { message: "synthetic failure" } : null })).then(resolve, reject),
    };
    return builder;
  };
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/messages?")) return new Response(JSON.stringify({ data: [{ id: "m1", conversationId: "CN12345678", phoneNumberId: "PN12345678", direction: "incoming", text: tables.quo_messages[0].text, createdAt: "2026-10-15T16:00:00Z" }], nextPageToken: null }), { status: options.directFail ? 503 : 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ evidence: options.modelEvidence ?? [{ signal: "completed", message_id: "m1", quote: tables.quo_messages[0].text }] }) } }] }), { status: options.aiFail ? 503 : 200 });
  });
  const handler = createProcessorBoardHandler({
    createClient: (() => ({ from, rpc, auth: { getUser: async () => ({ data: { user: options.signedIn === false ? null : { id: "actor" } }, error: null }) } })) as unknown as Parameters<typeof createProcessorBoardHandler>[0]["createClient"],
    env: (name) => name === "QUO_API_KEY" && options.noDirect ? undefined : "synthetic-server-key", fetcher, now: () => new Date("2026-10-15T18:00:00Z"),
  });
  const request = (body: unknown = { action: "assess", leadId: ID }) => handler(new Request("https://example.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify(body) }));
  return { request, rpc, reads, fetcher, tables };
}
describe("Processor Board server boundary", () => {
  it.each(["customer_service", "cs_admin", "opr", "opr_admin"])("rejects %s before reading leads/chats or invoking AI", async (role) => {
    const s = setup({ role }); expect((await s.request()).status).toBe(403); expect(s.reads).toEqual(["user_roles"]); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("requires a real authenticated user", async () => {
    const s = setup({ signedIn: false }); expect((await s.request()).status).toBe(401); expect(s.reads).toEqual([]);
  });
  it.each([{ hidden: true }, { visible: false }])("does not bypass caller lead/status scope: %j", async (options) => {
    const s = setup(options); expect((await s.request()).status).toBe(404); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("saves only job-specific advisory evidence and reuses unchanged inputs without a second AI call", async () => {
    const s = setup(); const first = await s.request(); expect(first.status).toBe(200);
    expect((await first.json()).result).toMatchObject({ status: "payment_pending", ai_used: true, history_complete: true, source: "Quo current history" });
    expect((await s.request()).status).toBe(200);
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("openai"))).toHaveLength(1);
    expect(s.reads.filter((name) => name === "quo_messages")).toHaveLength(0);
    expect(s.rpc.mock.calls.filter(([name]) => name === "save_processor_job_assessment")).toHaveLength(1);
    expect(s.tables.leads).toEqual([job]);
  });
  it("does not save or claim success on an AI, incomplete-history or persistence failure", async () => {
    for (const options of [{ aiFail: true }, { failMessages: true, noDirect: true }, { directFail: true }, { failSave: true }]) {
      const s = setup(options); expect((await s.request()).status).toBeGreaterThanOrEqual(400);
      expect(s.tables.processor_job_assessments).toEqual([]); expect(s.tables.leads).toEqual([job]);
    }
  });
  it("does not start a duplicate provider review while another session owns the lease", async () => {
    const s = setup({ busy: true }); expect((await s.request()).status).toBe(429); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ tech_number: null }, { scheduled_date: null }, { scheduled_time_start: null }])("rejects incomplete saved jobs before service leases, chat reads or provider calls: %j", async (missing) => {
    const s = setup(); s.tables.leads = [{ ...job, ...missing }];
    const response = await s.request();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "job_setup", retryable: false });
    expect(s.reads).toEqual(["user_roles", "leads"]);
    expect(s.rpc.mock.calls.map(([name]) => name)).toEqual(["processor_can_view_status"]);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes provider failures without exposing provider bodies or saving partial reviews", async () => {
    for (const [options, code] of [[{ aiFail: true }, "ai_provider"], [{ directFail: true }, "history_provider"]] as const) {
      const s = setup(options); const response = await s.request();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code, retryable: true });
      expect(s.tables.processor_job_assessments).toEqual([]);
      expect(s.tables.leads).toEqual([job]);
    }
  });
  it("keeps a successful advisory save successful when lease cleanup fails", async () => {
    const s = setup({ failRelease: true });
    const response = await s.request();
    expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("payment_pending");
    expect(s.tables.processor_job_assessments).toHaveLength(1);
    expect(s.tables.leads).toEqual([job]);
  });
  it("rejects ambiguous technician identity rather than choosing a convenient chat", async () => {
    const s = setup(); s.tables.technicians.push({ id: "duplicate", phone_number: "4155550199", chat_link: "https://my.quo.com/inbox/PN12345678/c/CNother123" });
    expect((await s.request()).status).toBe(422); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("rejects closed paid jobs and ignores browser-supplied lead snapshots", async () => {
    const s = setup(); s.tables.leads = [{ ...job, status: "paid" }];
    expect((await s.request({ action: "assess", leadId: ID, status: "scheduled", tech_number: "other" })).status).toBe(409); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("does not infer non-response from mirror-only ingestion", async () => {
    const accepted = "I accept JOB-1001 and will take this job";
    const request = "Please give an update on JOB-1001 now";
    const s = setup({ noDirect: true, modelEvidence: [{ signal: "accepted", message_id: "accept", quote: accepted }, { signal: "update_request", message_id: "request", quote: request }] });
    s.tables.quo_messages = [
      { id: "accept", conversation_id: "mirror", sender: "customer", text: accepted, message_time: "2026-10-15T14:00:00Z" },
      { id: "request", conversation_id: "mirror", sender: "agent", text: request, message_time: "2026-10-15T16:00:00Z", status: "delivered" },
    ];
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "needs_review", history_complete: false });
  });
  it("does not invoke or claim AI when the complete chat only identifies another job", async () => {
    const s = setup(); s.tables.quo_messages[0].text = "JOB-1002 is completed and ready for payment.";
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "take_job_update", ai_used: false, matched_messages: 0, evidence: [] });
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("openai"))).toHaveLength(0);
    expect(s.tables.leads).toEqual([job]);
  });
  it.each(["job_done", "cancelled", "payment_requested", "cancellation_requested", "needs_reschedule"])("does not let AI bypass the saved %s workflow", async (status) => {
    const s = setup(); s.tables.leads = [{ ...job, status }];
    expect((await s.request()).status).toBe(409);
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.rpc.mock.calls.map(([name]) => name)).toEqual(["processor_can_view_status"]);
  });
});
