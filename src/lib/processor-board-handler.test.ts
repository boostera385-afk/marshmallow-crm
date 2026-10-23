// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createProcessorBoardHandler, createProcessorDailyHandler } from "../../supabase/functions/_shared/processor-board-handler";

const ID = "00000000-0000-4000-8000-000000000001";
const job = { id: ID, job_id: "LD-1001", customer_name: "Shanice Walker", customer_phone: "4045550101", address: "12 Peach St", service_type: "Furniture Assembly", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-08T15:00:00Z" };
const peer = { ...job, id: "00000000-0000-4000-8000-000000000002", job_id: "LD-2002", customer_name: "Jeff Moore" };
type Row = Record<string, unknown>;
const text = (id: string, sender: "agent" | "customer", body: string, at: string, conversation = "mirror"): Row => ({ id, conversation_id: conversation, sender, text: body, message_time: at, status: sender === "agent" ? "delivered" : "received" });
const CUSTOMER_CONVERSATION = { id: "cust", quo_conversation_id: "CNcustomer1", customer_number: "+14045550101", last_message_time: "2026-10-15T17:00:00Z", quo_phone_numbers: { quo_phone_number_id: "PNoffice12", number: "+18005550100", display_number: null } };
const CHAT = [
  text("old", "agent", "Shanice Walker old visit details", "2026-09-01T10:00:00Z"),
  text("dispatch", "agent", "New job for Shanice at 12 Peach St, furniture assembly", "2026-10-08T14:00:00Z"),
  text("ok", "customer", "Ok got it, I'll take it", "2026-10-08T14:05:00Z"),
  text("done", "customer", "Shanice job is all done", "2026-10-15T16:00:00Z"),
];
type Model = { enough_context?: boolean; tech_took_job?: boolean; job_update?: string; waiting_on_technician_message_id?: string | null; summary?: string; evidence?: unknown[] };
const COMPLETED: Model = { enough_context: true, tech_took_job: true, job_update: "completed", summary: "Technician finished the job.", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "completed", message_id: "done", quote: "all done" }] };
// Small stand-in for the SQL rule (tested in supabase/tests/156); only shapes the audit line here.
const mockStatus = (result: { job_update?: string; enough_context?: boolean }) => result.job_update === "completed" ? "payment_pending" : result.job_update === "in_progress" ? "job_in_progress" : result.enough_context ? "take_job_update" : "not_enough_details";

type PaymentModel = { state?: string; promised_date?: string | null; summary?: string; evidence?: unknown[] };
function setup(options: { role?: string; signedIn?: boolean; visible?: boolean; hidden?: boolean; failSave?: boolean; failCalls?: boolean; lookupFail?: boolean; busy?: boolean; aiFail?: boolean; noDirect?: boolean; directFail?: boolean; failRelease?: boolean; model?: Model; paymentModel?: PaymentModel; customerFail?: boolean; candidates?: string[]; noDailySecret?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    user_roles: [{ role: options.role ?? "processor" }], leads: options.hidden ? [] : [job, peer],
    technicians: [{ id: "tech", phone_number: "4155550199", chat_link: "https://my.quo.com/inbox/PN12345678/c/CN12345678" }],
    quo_conversations: [{ id: "mirror", quo_conversation_id: "CN12345678", customer_number: "+14155550199", last_message_time: "2026-10-15T16:00:00Z", quo_phone_numbers: { quo_phone_number_id: "PN12345678", number: "+17475887812", display_number: null } }, CUSTOMER_CONVERSATION],
    quo_messages: [...CHAT], processor_job_assessments: [],
  };
  const reads: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "processor_can_view_status") return { data: options.visible !== false, error: null };
    if (name === "claim_processor_job_refresh") return { data: !options.busy, error: null };
    if (name === "processor_board_status") return { data: mockStatus(args.p_result as Model), error: null };
    if (name === "processor_customer_last_message") return { data: CUSTOMER_CONVERSATION.last_message_time, error: null };
    if (name === "processor_board_daily_candidates") return { data: options.candidates ?? [], error: null };
    if (name === "save_processor_job_assessment") {
      if (!options.failSave) tables.processor_job_assessments = [{ input_hash: args.p_hash, result: args.p_result }];
      return { data: !options.failSave, error: null };
    }
    return { data: { rows: tables.leads, total: tables.leads.length, counts: {}, all_total: tables.leads.length, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" }, error: null };
  });
  const from = (name: string) => {
    reads.push(name);
    let single = false; let callsOnly = false; let customerLookup = false; let since = ""; let low = 0; let high = Infinity; let conversations: unknown[] | null = null; let idFilter: unknown = null;
    const builder = {
      select: () => builder, ilike: () => builder, neq: () => builder, limit: () => builder, order: () => builder, lte: () => builder, delete: vi.fn(() => builder),
      eq: (column: string, value: unknown) => { if (column === "conversation_id") conversations = [value]; if (column === "id" && name === "leads") idFilter = value; return builder; },
      in: (column: string, values: unknown[]) => { if (column === "conversation_id") conversations = values; return builder; },
      or: (filter: string) => { if (filter.includes("quo_message_id")) callsOnly = true; if (filter.includes("linked_lead_id")) customerLookup = true; return builder; },
      gte: (column: string, value: string) => { if (column === "message_time") since = value; return builder; },
      maybeSingle: () => { single = true; return builder; }, range: (a: number, b: number) => { low = a; high = b; return builder; },
      then: (resolve: (v: unknown) => unknown, reject?: (reason: unknown) => unknown) => (name === "processor_job_refresh_locks" && options.failRelease
        ? Promise.reject(new Error("Synthetic lease cleanup failure"))
        : Promise.resolve({ data: single ? (tables[name] ?? []).find((row) => idFilter === null || row.id === idFilter) ?? null : (tables[name] ?? [])
          .filter((row) => !callsOnly || /:call\.(?:completed|transcript\.completed)$/.test(String(row.quo_message_id)))
          .filter((row) => name !== "quo_messages" || !since || String(row.message_time) >= since)
          .filter((row) => !conversations || conversations.includes(row.conversation_id)).slice(low, high + 1),
        error: (name === "quo_messages" && callsOnly && options.failCalls) || (name === "technicians" && options.lookupFail) || (customerLookup && options.customerFail) ? { message: "synthetic failure" } : null })).then(resolve, reject),
    };
    return builder;
  };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/messages?")) {
      const after = new URLSearchParams(String(url).split("?")[1]).get("createdAfter") ?? "";
      return new Response(JSON.stringify({ data: tables.quo_messages.filter((m) => m.conversation_id === "mirror" && !String(m.quo_message_id ?? "").includes(":call.") && String(m.message_time) > after).map((m) => ({ id: m.id, conversationId: "CN12345678", phoneNumberId: "PN12345678", direction: m.sender === "agent" ? "outgoing" : "incoming", text: m.text, status: m.status ?? "received", createdAt: m.message_time })), nextPageToken: null }), { status: options.directFail ? 503 : 200 });
    }
    const paymentCall = String(JSON.parse(String(init?.body)).messages[0].content).includes("customer's chat");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(paymentCall ? options.paymentModel ?? { state: "unclear" } : options.model ?? COMPLETED) } }] }), { status: options.aiFail ? 503 : 200 });
  });
  const deps = {
    createClient: (() => ({ from, rpc, auth: { getUser: async () => ({ data: { user: options.signedIn === false ? null : { id: "actor" } }, error: null }) } })) as unknown as Parameters<typeof createProcessorBoardHandler>[0]["createClient"],
    env: (name: string) => (name === "QUO_API_KEY" && options.noDirect) || (name === "PROCESSOR_DAILY_CRON_SECRET" && options.noDailySecret) ? undefined : "synthetic-server-key", fetcher, now: () => new Date("2026-10-15T18:00:00Z"),
  };
  const handler = createProcessorBoardHandler(deps);
  const daily = createProcessorDailyHandler(deps);
  const dailyRequest = (secret = "synthetic-server-key", body: unknown = {}) => daily(new Request("https://example.invalid", { method: "POST", headers: { "x-cron-secret": secret }, body: JSON.stringify(body) }));
  const request = (body: unknown = { action: "assess", leadId: ID }) => handler(new Request("https://example.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify(body) }));
  const aiCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes("openai"));
  const prompt = (index = 0) => JSON.parse(JSON.parse(String(aiCalls()[index][1]?.body)).messages[1].content);
  return { request, dailyRequest, rpc, reads, fetcher, tables, aiCalls, prompt };
}

describe("Processor Board server boundary", () => {
  it.each([false, true])("reviews this lead's chat from the first customer mention (mirror-only=%s)", async (noDirect) => {
    const s = setup({ noDirect });
    const response = await s.request();
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result).toMatchObject({ policy: 10, tech_phone: "4155550199", status: "payment_pending", job_update: "completed", tech_took_job: true, enough_context: true, ai_used: true, ai_reused: false, history_complete: !noDirect,
      window: { anchor: "customer_mention", anchor_message_id: "dispatch", messages: 3, omitted: 0 } });
    const prompt = s.prompt();
    expect(prompt.untrustedMessages.map((m: { id: string }) => m.id)).toEqual(["dispatch", "ok", "done"]);
    expect(prompt.target).toMatchObject({ job_id: "LD-1001", customer_name: "Shanice Walker", scheduled_date: "2026-10-15" });
    expect(prompt.otherJobs).toEqual([{ job_id: "LD-2002", customer_name: "Jeff Moore" }]);
    expect(s.rpc.mock.calls.find(([name]) => name === "save_processor_job_assessment")?.[1]).toMatchObject({ p_lead_id: ID, p_updated_at: job.updated_at, p_actor: "actor" });
    expect(s.tables.leads[0]).toEqual(job);
  });
  it("reviews the whole chat from the day before the lead when the customer is never named", async () => {
    const s = setup({ model: { enough_context: false, summary: "Nothing about this job." } });
    s.tables.quo_messages = [text("early", "agent", "hello", "2026-10-01T10:00:00Z"), text("later", "customer", "available tomorrow", "2026-10-09T10:00:00Z")];
    const { result } = await (await s.request()).json();
    expect(result).toMatchObject({ window: { anchor: "lead_created", start: "2026-10-07T15:00:00.000Z", messages: 1 }, enough_context: false, status: "not_enough_details" });
    expect(s.prompt().untrustedMessages.map((m: { id: string }) => m.id)).toEqual(["later"]);
  });
  it("sends speaker-verified call transcript segments with the texts", async () => {
    const quote = "Shanice house is finished";
    const s = setup({ noDirect: true, model: { enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "completed", message_id: "transcript:transcript-row:0", quote }] } });
    s.tables.quo_messages = [CHAT[1], CHAT[2],
      { id: "call-row", quo_message_id: "AC123456:call.completed", conversation_id: "mirror", sender: "agent", status: "completed", text: "Call completed.", message_time: "2026-10-15T15:00:00Z", raw_payload: { type: "call.completed", data: { object: { id: "AC123456", conversationId: "CN12345678", phoneNumberId: "PN12345678", from: "+17475887812", to: ["+14155550199"], createdAt: "2026-10-15T15:00:00Z", answeredAt: "2026-10-15T15:00:01Z", completedAt: "2026-10-15T15:01:00Z" } } } },
      { id: "transcript-row", quo_message_id: "AC123456:call.transcript.completed", conversation_id: "mirror", sender: "agent", status: "call.transcript.completed", text: `Call transcript: ${quote}`, message_time: "2026-10-15T16:00:00Z", raw_payload: { type: "call.transcript.completed", data: { object: { callId: "AC123456", status: "completed", dialogue: [{ content: quote, userId: null, identifier: "+14155550199", start: 5, end: 10 }] } } } },
    ];
    s.tables.quo_conversations[0].last_message_time = "2026-10-15T15:01:00Z";
    const response = await s.request();
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ job_update: "completed", call_transcripts: { state: "available", checked: 1 }, evidence: [{ signal: "took_job" }, { signal: "completed", via: "call", from: "technician" }] });
    expect(s.prompt().untrustedMessages).toEqual(expect.arrayContaining([expect.objectContaining({ via: "call", from: "technician", text: quote }), expect.objectContaining({ via: "call", text: "[answered phone call]" })]));
  });
  it("reuses saved facts without a new AI call when the lead's chat is unchanged, and re-reads after new activity", async () => {
    const s = setup();
    await s.request();
    const repeated = await (await s.request()).json();
    expect(repeated).toMatchObject({ cached: true, result: { ai_reused: true, ai_used: false, job_update: "completed" } });
    expect(s.aiCalls()).toHaveLength(1);
    s.tables.quo_messages.push(text("new", "customer", "Shanice wants another shelf", "2026-10-15T17:00:00Z"));
    await s.request();
    expect(s.aiCalls()).toHaveLength(2);
  });
  it("saves Not enough details without AI when the lead has no chat at all", async () => {
    const s = setup(); s.tables.quo_messages = [];
    s.tables.quo_conversations[0].last_message_time = null;
    const { result } = await (await s.request()).json();
    expect(result).toMatchObject({ enough_context: false, ai_used: false, status: "not_enough_details", window: { messages: 0 } });
    expect(s.aiCalls()).toHaveLength(0);
    expect(s.tables.processor_job_assessments).toHaveLength(1);
  });
  it("does not trust an unquoted completion from AI", async () => {
    const s = setup({ model: { enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "completed", message_id: "done", quote: "invoice paid in full" }] } });
    expect((await (await s.request()).json()).result).toMatchObject({ job_update: "none", tech_took_job: false, evidence: [] });
  });
  it("records when our job question went unanswered after the technician took the job", async () => {
    const s = setup({ model: { enough_context: true, tech_took_job: true, job_update: "none", waiting_on_technician_message_id: "ask", evidence: [{ signal: "took_job", message_id: "ok", quote: "I'll take it" }] } });
    s.tables.quo_messages = [CHAT[1], CHAT[2], text("ask", "agent", "Any update on Shanice?", "2026-10-15T15:30:00Z")];
    s.tables.quo_conversations[0].last_message_time = "2026-10-15T15:30:00Z";
    expect((await (await s.request()).json()).result).toMatchObject({ tech_took_job: true, waiting_since: "2026-10-15T15:30:00Z", waiting_message_id: "ask" });
  });
  it("refuses a mirror that is behind its latest activity instead of guessing silence", async () => {
    const s = setup({ noDirect: true }); s.tables.quo_conversations[0].last_message_time = "2026-10-15T17:30:00Z";
    const response = await s.request();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "mirror_behind", retryable: true });
    expect(s.aiCalls()).toHaveLength(0);
    expect(s.tables.processor_job_assessments).toEqual([]);
  });
  it.each(["customer_service", "cs_admin", "opr", "opr_admin"])("rejects %s before reading leads/chats or invoking AI", async (role) => {
    const s = setup({ role }); expect((await s.request()).status).toBe(403); expect(s.reads).toEqual(["user_roles"]); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("requires a real authenticated user", async () => {
    const s = setup({ signedIn: false }); expect((await s.request()).status).toBe(401); expect(s.reads).toEqual([]);
  });
  it.each([{ hidden: true }, { visible: false }])("does not bypass caller lead/status scope: %j", async (options) => {
    const s = setup(options); expect((await s.request()).status).toBe(404); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("does not save or claim success on an AI, history or persistence failure", async () => {
    for (const [options, code] of [[{ aiFail: true }, "ai_provider"], [{ directFail: true }, "history_provider"], [{ failSave: true }, undefined]] as const) {
      const s = setup(options); const response = await s.request();
      expect(response.status).toBeGreaterThanOrEqual(400);
      if (code) expect(await response.json()).toMatchObject({ code, retryable: true });
      expect(s.tables.processor_job_assessments).toEqual([]); expect(s.tables.leads[0]).toEqual(job);
    }
  });
  it("does not start a duplicate review while another session owns the lease", async () => {
    const s = setup({ busy: true }); expect((await s.request()).status).toBe(429); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("rejects a job without a valid technician number before leases, chat reads or AI", async () => {
    const s = setup(); s.tables.leads = [{ ...job, tech_number: null }];
    const response = await s.request();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "job_setup", retryable: false });
    expect(s.rpc.mock.calls.map(([name]) => name)).toEqual(["processor_can_view_status"]);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("checks an assigned job whose appointment time is not saved yet", async () => {
    const s = setup(); s.tables.leads = [{ ...job, scheduled_time_start: null }, peer];
    expect((await s.request()).status).toBe(200);
  });
  it.each(["paid", "partial_paid", "cancelled", "scammed"])("rejects a %s job and ignores browser-supplied lead snapshots", async (status) => {
    const s = setup(); s.tables.leads = [{ ...job, status }];
    expect((await s.request({ action: "assess", leadId: ID, status: "scheduled", tech_number: "other" })).status).toBe(409); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("keeps a successful save successful when lease cleanup fails", async () => {
    const s = setup({ failRelease: true });
    expect((await s.request()).status).toBe(200);
    expect(s.tables.processor_job_assessments).toHaveLength(1);
  });
  it("rejects ambiguous technician chats rather than choosing one", async () => {
    const s = setup(); s.tables.technicians.push({ id: "duplicate", phone_number: "4155550199", chat_link: "https://my.quo.com/inbox/PN12345678/c/CNother123" });
    expect((await s.request()).status).toBe(422); expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("lists the board with the AI status filter, two batched chat reads and no provider calls", async () => {
    const s = setup();
    const response = await s.request({ action: "list", offset: 25, search: "shan", aiStatus: "send_dose" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ total: 2, monitoring: { ai_configured: true, current_history_configured: true, evidence_policy: 10 } });
    expect(payload.rows.every((row: { chat_setup: { state: string } }) => row.chat_setup.state === "ready")).toBe(true);
    expect(s.rpc).toHaveBeenCalledWith("list_processor_board_jobs", { p_offset: 25, p_search: "shan", p_timezone: "America/New_York", p_ai_status: "send_dose" });
    expect(s.reads).toEqual(["user_roles", "technicians", "quo_conversations"]);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("rejects an unknown AI status filter", async () => {
    const s = setup(); expect((await s.request({ action: "list", aiStatus: "needs_review" })).status).toBe(400); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("keeps saved jobs visible when chat lookup fails", async () => {
    const s = setup({ lookupFail: true });
    const response = await s.request({ action: "list" }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 2, rows: [{ id: ID, chat_setup: { state: "unavailable", code: "chat_lookup" } }, { chat_setup: { state: "unavailable" } }] });
  });

  describe("completed, unpaid jobs", () => {
    const customerChat = [
      text("c-thanks", "customer", "Thanks, the furniture looks great", "2026-10-15T16:30:00Z", "cust"),
      text("c-ask", "agent", "Hi Shanice, your total is $180. Please send payment today.", "2026-10-15T17:00:00Z", "cust"),
    ];
    const waiting: PaymentModel = { state: "waiting_on_customer", summary: "We asked for $180; no reply yet.", evidence: [{ signal: "asked", message_id: "c-ask", quote: "Please send payment today." }] };
    it("reads the customer's own chat, separately from the tech chat, and records who is waiting", async () => {
      const s = setup({ paymentModel: waiting }); s.tables.quo_messages.push(...customerChat);
      const { result } = await (await s.request()).json();
      expect(result).toMatchObject({ job_update: "completed", completed_at: "2026-10-15T16:00:00Z", customer_last_message_at: "2026-10-15T17:00:00Z",
        payment: { state: "waiting_on_customer", waiting_since: "2026-10-15T17:00:00Z", evidence: [{ signal: "asked", from: "our_team" }], window: { messages: 2, conversations: 1 } } });
      expect(s.aiCalls()).toHaveLength(2);
      expect(s.prompt(0).untrustedMessages.map((m: { id: string }) => m.id)).not.toContain("c-ask");
      expect(s.prompt(1)).toMatchObject({ today: "2026-10-15", job: { job_id: "LD-1001" } });
      expect(s.prompt(1).untrustedMessages.map((m: { id: string; from: string }) => [m.id, m.from])).toEqual([["c-thanks", "customer"], ["c-ask", "our_team"]]);
    });
    it("does not call the customer silent when they replied after our payment request", async () => {
      const s = setup({ paymentModel: waiting });
      s.tables.quo_messages.push(...customerChat, text("c-reply", "customer", "I'll check with my husband", "2026-10-15T17:30:00Z", "cust"));
      expect((await (await s.request()).json()).result.payment).toMatchObject({ state: "unclear", waiting_since: null });
    });
    it("keeps a promised date only with the customer's own words", async () => {
      const s = setup({ paymentModel: { state: "promised", promised_date: "2026-10-17", evidence: [{ signal: "promised", message_id: "c-promise", quote: "I will pay Friday" }] } });
      s.tables.quo_messages.push(text("c-promise", "customer", "I will pay Friday", "2026-10-15T17:10:00Z", "cust"));
      expect((await (await s.request()).json()).result.payment).toMatchObject({ state: "promised", promised_date: "2026-10-17" });
      const t = setup({ paymentModel: { state: "promised", promised_date: "2026-10-17", evidence: [{ signal: "promised", message_id: "c-ask", quote: "Please send payment today." }] } });
      t.tables.quo_messages.push(...customerChat);
      expect((await (await t.request()).json()).result.payment).toMatchObject({ state: "unclear", promised_date: null });
    });
    it("reuses both answers when nothing changed and re-asks only about the customer after a new customer message", async () => {
      const s = setup({ paymentModel: waiting }); s.tables.quo_messages.push(...customerChat);
      await s.request();
      expect((await (await s.request()).json())).toMatchObject({ cached: true, result: { ai_reused: true } });
      expect(s.aiCalls()).toHaveLength(2);
      s.tables.quo_messages.push(text("c-new", "customer", "Sent it on Zelle just now", "2026-10-15T17:45:00Z", "cust"));
      await s.request();
      expect(s.aiCalls()).toHaveLength(3);
      expect(String(JSON.parse(String(s.aiCalls()[2][1]?.body)).messages[0].content)).toContain("customer's chat");
    });
    it("saves the technician result when the customer chat cannot be read, and says so", async () => {
      const s = setup({ customerFail: true });
      const response = await s.request();
      expect(response.status).toBe(200);
      const { result } = await response.json();
      expect(result).toMatchObject({ job_update: "completed", payment_error: expect.stringContaining("daily check will retry") });
      expect(result.payment).toBeUndefined();
      expect(s.tables.processor_job_assessments).toHaveLength(1);
    });
    it("does not read customer chats for jobs that are not completed", async () => {
      const s = setup({ model: { enough_context: true, tech_took_job: true, job_update: "in_progress", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "in_progress", message_id: "done", quote: "Shanice job" }] } });
      s.tables.quo_messages.push(...customerChat);
      const { result } = await (await s.request()).json();
      expect(result.payment).toBeUndefined();
      expect(s.aiCalls()).toHaveLength(1);
      expect(s.rpc.mock.calls.map(([name]) => name)).not.toContain("processor_customer_last_message");
    });
    it("checks the customer chat for a lead saved as Payment Pending even without a tech completion message", async () => {
      const s = setup({ model: { enough_context: true, tech_took_job: true, job_update: "none", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }] }, paymentModel: waiting });
      s.tables.leads = [{ ...job, status: "payment_pending" }, peer]; s.tables.quo_messages.push(...customerChat);
      const { result } = await (await s.request()).json();
      expect(result).toMatchObject({ completed_at: null, payment: { state: "waiting_on_customer" } });
    });
  });

  describe("daily check worker", () => {
    it("refuses calls without its own secret, before reading anything", async () => {
      for (const [options, secret, status] of [[{ noDailySecret: true }, "synthetic-server-key", 503], [{}, "wrong", 401], [{}, "", 401]] as const) {
        const s = setup(options);
        expect((await s.dailyRequest(secret)).status).toBe(status);
        expect(s.reads).toEqual([]); expect(s.rpc).not.toHaveBeenCalled();
      }
    });
    it("checks the database's candidates as the daily check and returns no customer data", async () => {
      const s = setup({ candidates: [ID], paymentModel: { state: "waiting_on_customer", evidence: [{ signal: "asked", message_id: "c-ask", quote: "Please send payment" }] } });
      s.tables.quo_messages.push(text("c-ask", "agent", "Please send payment", "2026-10-15T17:00:00Z", "cust"));
      const response = await s.dailyRequest("synthetic-server-key", { limit: 50 });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toEqual({ checked: 1, failed: 0, results: [{ lead_id: ID, ok: true, status: "payment_pending" }] });
      expect(JSON.stringify(payload)).not.toContain("Shanice");
      expect(s.rpc).toHaveBeenCalledWith("processor_board_daily_candidates", { p_limit: 5 });
      expect(s.rpc.mock.calls.find(([name]) => name === "save_processor_job_assessment")?.[1]).toMatchObject({ p_lead_id: ID, p_actor: null });
      expect((s.tables.processor_job_assessments[0].result as { checked_by: string }).checked_by).toBe("daily_check");
      expect(s.reads).not.toContain("user_roles");
    });
    it("reports a job it could not check without stopping the batch", async () => {
      const s = setup({ candidates: ["00000000-0000-4000-8000-0000000000aa", ID] });
      const payload = await (await s.dailyRequest()).json();
      expect(payload.checked).toBe(1);
      expect(payload.results[0]).toMatchObject({ ok: false });
    });
  });
});
