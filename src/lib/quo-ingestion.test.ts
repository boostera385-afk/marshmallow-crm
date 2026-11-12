import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuoWebhookHandler } from "../../supabase/functions/_shared/quo-webhook-handler";

const payload = { id: "synthetic-delivery", type: "message.received", data: { object: {
  object: "message", id: "synthetic-message", conversationId: "synthetic-chat", phoneNumberId: "synthetic-line",
  direction: "incoming", from: "+15550100001", to: ["+15550100999"], text: "Synthetic Friday appointment", createdAt: "2026-11-12T12:00:00Z",
} } };

function setup(logPaused: boolean) {
  const env: Record<string,string> = { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key" };
  const state = { paused: false, pauseError: false, auditError: false };
  const writes: string[] = [];
  const rpc = vi.fn(async (_name: string, _args: { p_input: Record<string,unknown> }) => ({ data: { success: true, conversation_id: "chat-1", message_id: "message-1", linked_lead_id: "lead-1" }, error: null as null | { code: string; message: string } }));
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query,
      update: () => { writes.push(`update:${table}`); return query; },
      upsert: () => { writes.push(`upsert:${table}`); return query; },
      maybeSingle: async () => ({ data: { value: state.paused }, error: state.pauseError ? { message: "Synthetic control failure" } : null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: state.auditError ? { message: "Synthetic audit failure" } : null }).then(resolve),
    };
    return query;
  });
  const createClient = vi.fn(() => ({ from, rpc }) as unknown as SupabaseClient);
  const handler = createQuoWebhookHandler({ createClient, env: (name) => env[name], logPaused });
  const request = (body: unknown = payload, headers: Record<string,string> = {}) => handler(new Request("https://synthetic.invalid/webhook", { method: "POST", body: JSON.stringify(body), headers }));
  return { env,state,writes,rpc,from,createClient,handler,request };
}

beforeEach(() => { vi.stubGlobal("crypto",webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe.each([false,true])("shared Quo webhook (paused audit=%s)",(logPaused) => {
  it("uses one atomic save RPC after the pause read, with the normalized saved-message input",async () => {
    const m=setup(logPaused);
    const res=await m.request();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success:true,message_id:"message-1" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("ingest_quo_message",{ p_input: expect.objectContaining({ event_id:"synthetic-delivery",event_type:"message.received",raw_payload:payload,message:expect.objectContaining({ id:"synthetic-message",sender:"customer",direction:"inbound" }) }) });
    expect(m.from.mock.calls.map(([table]) => table)).toEqual(["quo_ai_settings"]);
    expect(m.writes).toEqual([]);
  });
  it("rejects an invalid required signature before accessing the database",async () => {
    const m=setup(logPaused); m.env.QUO_WEBHOOK_SECRET="synthetic-signing-key"; m.env.QUO_STRICT_SIGNATURE="true";
    expect((await m.request(payload,{"x-quo-signature":"invalid"})).status).toBe(401);
    expect(m.createClient).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("accepts a valid required signature and retains signature verification in the audit input",async () => {
    const m=setup(logPaused); m.env.QUO_WEBHOOK_SECRET="synthetic-signing-key"; m.env.QUO_ENFORCE_SIGNATURE="true";
    const signature=createHmac("sha256",m.env.QUO_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
    expect((await m.request(payload,{"openphone-signature":signature})).status).toBe(200);
    expect(m.rpc.mock.calls[0][1].p_input.signature_verified).toBe(true);
  });
  it("honours ingestion pause without saving messages",async () => {
    const m=setup(logPaused); m.state.paused=true;
    expect(await (await m.request()).json()).toMatchObject({ paused:true,ignored:true });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.writes).toEqual(logPaused ? ["upsert:quo_webhook_events"] : []);
  });
  it("fails closed and asks for retry when the pause control cannot be read",async () => {
    const m=setup(logPaused); m.state.pauseError=true;
    expect((await m.request()).status).toBe(503); expect(m.rpc).not.toHaveBeenCalled(); expect(m.writes).toEqual([]);
  });
  it("does not acknowledge a missing migration or failed save as a duplicate",async () => {
    const m=setup(logPaused); m.rpc.mockResolvedValue({ data:null,error:{ code:"PGRST202",message:"Synthetic missing RPC" } });
    const res=await m.request(); expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success:false,error:"Quo ingestion temporarily unavailable",retryable:true });
    expect(m.writes).toEqual([]);
  });
  it("does not claim success when the atomic RPC acknowledgement is invalid",async () => {
    const m=setup(logPaused); m.rpc.mockResolvedValue({ data:null,error:null });
    expect((await m.request()).status).toBe(503);
  });
  it("keeps logged unsupported events separate from message ingestion",async () => {
    const m=setup(logPaused);
    expect(await (await m.request({ id:"ignored",type:"synthetic.unsupported" })).json()).toMatchObject({ ignored:true });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.writes).toEqual(["upsert:quo_webhook_events"]);
  });
  it("surfaces audit failure instead of reporting successful ignored delivery",async () => {
    const m=setup(logPaused); m.state.auditError=true;
    expect((await m.request({ id:"ignored",type:"synthetic.unsupported" })).status).toBe(503);
  });
  it("rejects invalid JSON without saving a partial event",async () => {
    const m=setup(logPaused);
    const res=await m.handler(new Request("https://synthetic.invalid/webhook",{ method:"POST",body:"not-json" }));
    expect(res.status).toBe(400); expect(m.createClient).not.toHaveBeenCalled();
  });
});
