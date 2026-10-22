// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createProcessorBoardHandler } from "../../supabase/functions/_shared/processor-board-handler";

const ID = "00000000-0000-4000-8000-000000000001";
const job = { id: ID, job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-01T00:00:00Z" };
function setup(options: { role?: string; signedIn?: boolean; visible?: boolean; hidden?: boolean; failSave?: boolean; failMessages?: boolean; lookupFail?: boolean; busy?: boolean; aiFail?: boolean; noDirect?: boolean; directFail?: boolean; failRelease?: boolean; modelEvidence?: unknown[] } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    user_roles: [{ role: options.role ?? "processor" }], leads: options.hidden ? [] : [job],
    technicians: [{ id: "tech", phone_number: "4155550199", chat_link: "https://my.quo.com/inbox/PN12345678/c/CN12345678" }],
    quo_conversations: [{ id: "mirror", quo_conversation_id: "CN12345678", customer_number: "+14155550199", last_message_time: "2026-10-15T16:00:00Z", quo_phone_numbers: { quo_phone_number_id: "PN12345678", number: "+17475887812", display_number: null } }],
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
    return { data: { rows: tables.leads, total: tables.leads.length, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" }, error: null };
  });
  const from = (name: string) => {
    reads.push(name);
    let single = false;
    let low = 0; let high = Infinity;
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder, ilike: () => builder, or: () => builder, order: () => builder,
      gte: () => builder, lte: () => builder, delete: vi.fn(() => builder),
      maybeSingle: () => { single = true; return builder; }, range: (a: number, b: number) => { low = a; high = b; return builder; },
      then: (resolve: (v: unknown) => unknown, reject?: (reason: unknown) => unknown) => (name === "processor_job_refresh_locks" && options.failRelease
        ? Promise.reject(new Error("Synthetic lease cleanup failure"))
        : Promise.resolve({ data: single ? tables[name]?.[0] ?? null : (tables[name] ?? []).slice(low, high + 1), error: (name === "quo_messages" && options.failMessages) || (name === "technicians" && options.lookupFail) ? { message: "synthetic failure" } : null })).then(resolve, reject),
    };
    return builder;
  };
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/messages?")) return new Response(JSON.stringify({ data: tables.quo_messages.map((m) => ({ id: m.id, conversationId: "CN12345678", phoneNumberId: "PN12345678", direction: m.sender === "agent" ? "outgoing" : "incoming", text: m.text, status: m.status ?? "received", createdAt: m.message_time })), nextPageToken: null }), { status: options.directFail ? 503 : 200 });
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
  it("uses a technician reply that follows this job's saved dispatch and marks it context-attributed", async () => {
    const quote = "Finished the job and cleaned up";
    const s = setup({ modelEvidence: [{ signal: "completed", message_id: "generic", quote }] });
    s.tables.quo_messages = [{ id: "dispatch", sender: "agent", text: "Dispatch JOB-1001 for tomorrow at 10am", status: "delivered", message_time: "2026-10-15T14:00:00Z" }, { id: "generic", sender: "customer", text: quote, message_time: "2026-10-15T16:00:00Z" }];
    const response = await s.request(); expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result).toMatchObject({ status: "payment_pending", evidence: [{ quote, identity_basis: "thread_context" }], ai_used: true, matched_messages: 2, matched_technician_messages: 0, context_technician_messages: 1, unattributed_technician_messages: 0, extraction_messages: 2 });
    expect(result.summary).toContain("context-attributed");
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("openai"))).toHaveLength(1);
    expect(s.tables.leads).toEqual([job]);
  });
  it("does not attribute a technician reply after another job's dispatch or spend AI on it", async () => {
    const s = setup();
    s.tables.quo_messages = [
      { id: "dispatch", sender: "agent", text: "Dispatch JOB-1001 for tomorrow at 10am", status: "delivered", message_time: "2026-10-15T14:00:00Z" },
      { id: "other", sender: "agent", text: "Customer Name: Other Customer Customer Address: 99 Unknown Rd", status: "delivered", message_time: "2026-10-15T14:10:00Z" },
      { id: "generic", sender: "customer", text: "Done with the other property", message_time: "2026-10-15T14:15:00Z" },
    ];
    const response = await s.request(); expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result).toMatchObject({ status: "take_job_update", evidence: [], ai_used: false, matched_technician_messages: 0, context_technician_messages: 0, unattributed_technician_messages: 1, extraction_messages: 0 });
    expect(result.summary).toContain("No technician text reply is tied to this job");
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("openai"))).toHaveLength(0);
  });
  it("accepts a source-grounded factual span with identity elsewhere in the same message", async () => {
    const quote = "I have finished the installation and cleaned up.";
    const s = setup({ modelEvidence: [{ signal: "completed", message_id: "m1", quote }] });
    s.tables.quo_messages[0].text = `JOB-1001\n${quote}`;
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "payment_pending", evidence: [{ quote, identity_basis: "source_message" }], matched_technician_messages: 1 });
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
  it.each(["job_done", "cancelled"])("does not let AI reopen the saved %s workflow", async (status) => {
    const s = setup(); s.tables.leads = [{ ...job, status }];
    expect((await s.request()).status).toBe(409);
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.rpc.mock.calls.map(([name]) => name)).toEqual(["processor_can_view_status"]);
  });
  it.each(["payment_requested", "cancellation_requested", "needs_reschedule", "waiting_customer_response"])("reviews evidence without mutating or approving the saved %s workflow", async (status) => {
    const s = setup(); s.tables.leads = [{ ...job, status }];
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("payment_pending");
    expect(s.tables.leads).toEqual([{ ...job, status }]);
    expect(s.rpc.mock.calls.every(([name]) => ["processor_can_view_status", "claim_processor_job_refresh", "save_processor_job_assessment"].includes(name))).toBe(true);
  });
  it.each(["missing directory", "missing link"])("reviews the exact saved technician-line conversation despite %s, without repairing records", async (reason) => {
    const s = setup();
    s.tables.technicians = reason === "missing directory" ? [] : [{ phone_number: job.tech_number, chat_link: null }];
    const before = structuredClone(s.tables.technicians);
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "payment_pending", chat_source: "verified_mirror" });
    expect(s.tables.technicians).toEqual(before); expect(s.tables.leads).toEqual([job]);
  });
  it("enriches a 25-job page with two batched chat reads and no provider calls or leases", async () => {
    const s = setup(); s.tables.leads = Array.from({ length: 25 }, (_, i) => ({ ...job, id: String(i) }));
    const response = await s.request({ action: "list" }); expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.rows).toHaveLength(25); expect(payload.total).toBe(25);
    expect(payload.monitoring).toEqual({ ai_configured: true, current_history_configured: true });
    expect(payload.rows.every((row: { chat_setup: { state: string } }) => row.chat_setup.state === "ready")).toBe(true);
    expect(s.reads).toEqual(["user_roles", "technicians", "quo_conversations"]);
    expect(s.rpc.mock.calls.map(([name]) => name)).toEqual(["list_processor_jobs"]);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("keeps the exact queue and saved jobs visible when chat lookup fails", async () => {
    const s = setup({ lookupFail: true });
    const response = await s.request({ action: "list" }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, rows: [{ id: ID, chat_setup: { state: "unavailable", code: "chat_lookup" } }] });
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("derives Send Dose only from accepted work and a delivered unanswered request in verified current history", async () => {
    const accepted = "JOB-1001 accepted, I will take this job";
    const request = "Please give an update on JOB-1001 now";
    const s = setup({ modelEvidence: [{ signal: "accepted", message_id: "accept", quote: accepted }, { signal: "update_request", message_id: "request", quote: request }] });
    s.tables.technicians = [];
    s.tables.quo_messages = [{ id: "accept", sender: "customer", text: accepted, message_time: "2026-10-15T14:00:00Z" }, { id: "request", sender: "agent", text: request, message_time: "2026-10-15T16:00:00Z", status: "delivered" }];
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "send_dose", history_complete: true, chat_source: "verified_mirror" });
    expect(s.tables.leads).toEqual([job]);
    expect(s.reads).not.toContain("quo_outbound_messages");
  });
  it("derives progress only for the identified job and leaves its saved status untouched", async () => {
    const quote = "I have started work on JOB-1001 at the property";
    const s = setup({ modelEvidence: [{ signal: "progress", message_id: "m1", quote }] });
    s.tables.quo_messages[0].text = quote;
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("job_in_progress");
    expect(s.tables.leads).toEqual([job]);
  });
  it("rechecks all history without another AI extraction when only another job's message changes", async () => {
    const s = setup(); expect((await s.request()).status).toBe(200);
    s.tables.quo_messages.push({ id: "peer-reply", sender: "customer", text: "JOB-1002 is in progress at the other property", message_time: "2026-10-15T17:00:00Z" });
    s.tables.quo_conversations[0].last_message_time = "2026-10-15T17:00:00Z";
    const response = await s.request(); expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "payment_pending", messages_reviewed: 2, matched_messages: 1 });
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("/messages?"))).toHaveLength(2);
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("openai"))).toHaveLength(1);
    expect(s.tables.leads).toEqual([job]);
  });
});
