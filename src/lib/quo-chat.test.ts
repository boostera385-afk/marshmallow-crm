import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuoChatThread } from "./quo-chat";

const state = vi.hoisted(() => ({ conversations: [] as Record<string, unknown>[], messages: [] as Record<string, unknown>[], failMessages: false, calls: [] as { table: string; method: string; args: unknown[] }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  let from = 0; let to = 499;
  const query = {
    select: (...args: unknown[]) => record("select", args), eq: (...args: unknown[]) => record("eq", args),
    or: (...args: unknown[]) => record("or", args), order: (...args: unknown[]) => record("order", args),
    limit: (...args: unknown[]) => record("limit", args),
    range: (start: number, end: number) => { from = start; to = end; return record("range", [start, end]); },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "quo_conversations" ? state.conversations : state.messages.slice(from, to + 1), error: table === "quo_messages" && state.failMessages ? { message: "Synthetic mirror unavailable" } : null }).then(resolve),
  };
  function record(method: string, args: unknown[]) { state.calls.push({ table, method, args }); return query; }
  return query;
} } }));
const id = "00000000-0000-4000-8000-000000000123";
const saved = { id, quo_conversation_id: "CN12345678", customer_number: "+14155550199", customer_name: "Synthetic Tech", number_id: "line", last_message_time: "2026-10-22T15:00:00Z", updated_at: "2026-10-22T15:00:00Z",
  quo_phone_numbers: { id: "line", quo_phone_number_id: "PN12345678", number: "+17475887812", display_number: "(747) 588-7812", name: "Technician Communications", label: null } };
beforeEach(() => { state.conversations = [structuredClone(saved)]; state.messages = []; state.calls = []; state.failMessages = false; });
describe("pinned Processor Board CRM technician chat", () => {
  it("reads only the verified conversation and every message page, including recent replies after row 500", async () => {
    state.messages = Array.from({ length: 501 }, (_, index) => ({ id: `m-${index}`, sender: "customer", text: `Synthetic reply ${index}`, recipients: [], direction: "incoming", status: "received", message_time: "2026-10-22T15:00:00Z", conversation_id: id, media: [] }));
    const result = await fetchQuoChatThread("+14155550199", "tech", id);
    expect(result.conversation?.databaseId).toBe(id);
    expect(result.messages).toHaveLength(501);
    expect(result.messages.at(-1)?.text).toBe("Synthetic reply 500");
    expect(state.calls).toContainEqual({ table: "quo_conversations", method: "eq", args: ["id", id] });
    expect(state.calls.filter((call) => call.method === "or")).toEqual([]);
    expect(state.calls.filter((call) => call.table === "quo_messages" && call.method === "eq").every((call) => call.args[1] === id)).toBe(true);
    expect(state.calls.filter((call) => call.method === "range").map((call) => call.args)).toEqual([[0, 499], [500, 999]]);
  });
  it.each(["missing", "participant", "line"])("fails closed for %s instead of opening another/newest chat", async (problem) => {
    if (problem === "missing") state.conversations = [];
    if (problem === "participant") state.conversations = [{ ...saved, customer_number: "+14155550123" }];
    if (problem === "line") state.conversations = [{ ...saved, quo_phone_numbers: { ...saved.quo_phone_numbers, number: "+14155550111" } }];
    await expect(fetchQuoChatThread("+14155550199", "tech", id)).rejects.toThrow("not available in your CRM scope");
    expect(state.calls.filter((call) => call.table === "quo_messages")).toEqual([]);
  });
  it("surfaces message failures rather than claiming an empty successful chat", async () => {
    state.failMessages = true;
    await expect(fetchQuoChatThread("+14155550199", "tech", id)).rejects.toThrow("Synthetic mirror unavailable");
  });
  it("fails explicitly above the history limit rather than silently displaying a partial chat", async () => {
    state.messages = Array.from({ length: 10001 }, (_, index) => ({ id: `m-${index}`, text: "Synthetic" }));
    await expect(fetchQuoChatThread("+14155550199", "tech", id)).rejects.toThrow("No partial conversation was displayed");
    expect(state.calls.filter((call) => call.method === "range")).toHaveLength(21);
  });
  it("rejects malformed phone numbers and identifiers before any read", async () => {
    await expect(fetchQuoChatThread("+9914155550199", "tech", id)).rejects.toThrow("identity is invalid");
    await expect(fetchQuoChatThread("+14155550199", "tech", "bad-id")).rejects.toThrow("identity is invalid");
    expect(state.calls).toEqual([]);
  });
  it("keeps the existing non-pinned Quick Chat lookup and viewport unchanged", async () => {
    state.messages = Array.from({ length: 501 }, (_, index) => ({ id: `m-${index}`, text: "Synthetic", created_at: "2026-10-22T15:00:00Z" }));
    const result = await fetchQuoChatThread("+14155550199", "tech");
    expect(result.messages).toHaveLength(500);
    expect(state.calls.some((call) => call.method === "or")).toBe(true);
    expect(state.calls.filter((call) => call.method === "range")).toHaveLength(1);
  });
});
