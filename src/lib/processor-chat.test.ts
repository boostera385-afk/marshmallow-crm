// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readProcessorChats, resolveProcessorChat, type ProcessorMirror } from "../../supabase/functions/_shared/processor-chat";
const phone = "4155550199";
const link = "https://my.quo.com/inbox/PN12345678/c/CN12345678";
const mirror: ProcessorMirror = { id: "00000000-0000-4000-8000-000000000001", customer_number: "+14155550199", quo_conversation_id: "CN12345678", last_message_time: "2026-10-22T15:00:00Z", quo_phone_numbers: { quo_phone_number_id: "PN12345678", number: "+17475887812", display_number: null } };
describe("Processor Board exact saved-chat resolution", () => {
  it.each([{ directory: [] }, { directory: [{ phone_number: phone, chat_link: null }] }])("uses the unique saved exact-number technician-line chat without inventing a directory link: %j", async ({ directory }) => {
    const copy = structuredClone(directory);
    const resolved = await resolveProcessorChat(phone, directory, [mirror], true);
    expect(resolved.setup).toMatchObject({ state: "ready", source: "verified_mirror", conversation_id: mirror.id });
    expect(resolved.link?.chatLink).toBe(link);
    expect(directory).toEqual(copy);
  });
  it("rejects another participant and a customer-service line instead of choosing the latest chat", async () => {
    for (const row of [{ ...mirror, customer_number: "+14155550198" }, { ...mirror, quo_phone_numbers: { ...mirror.quo_phone_numbers!, number: "+14155550123", display_number: "+17475887812" } }]) {
      expect((await resolveProcessorChat(phone, [], [row], true)).setup.state).toBe("blocked");
    }
  });
  it("does not collapse an invalid international prefix to a US phone", async () => {
    expect((await resolveProcessorChat(phone, [], [{ ...mirror, customer_number: "+4414155550199" }], true)).setup.state).toBe("blocked");
  });
  it("rejects multiple exact-number technician conversations rather than taking the newest", async () => {
    const result = await resolveProcessorChat(phone, [], [mirror, { ...mirror, id: "other", quo_conversation_id: "CN87654321" }], true);
    expect(result.setup).toMatchObject({ state: "blocked", code: "ambiguous_chat" });
  });
  it("never bypasses conflicting or invalid directory links with a convenient mirror", async () => {
    const conflicting = [{ phone_number: phone, chat_link: link }, { phone_number: phone, chat_link: link.replace("CN12345678", "CN87654321") }];
    expect((await resolveProcessorChat(phone, conflicting, [mirror], true)).setup.code).toBe("ambiguous_chat");
    expect((await resolveProcessorChat(phone, [{ phone_number: phone, chat_link: "https://example.invalid/inbox/PN12345678/c/CN12345678" }], [mirror], true)).setup.code).toBe("invalid_chat_link");
  });
  it("checks the saved link's participant and line and permits direct-only history only when configured", async () => {
    const directory = [{ phone_number: phone, chat_link: link }];
    expect((await resolveProcessorChat(phone, directory, [], true)).setup.state).toBe("ready");
    expect((await resolveProcessorChat(phone, directory, [], false)).setup.code).toBe("missing_mirror");
    expect((await resolveProcessorChat(phone, directory, [{ ...mirror, customer_number: "+14155550123" }], true)).setup.code).toBe("chat_identity");
    expect((await resolveProcessorChat(phone, directory, [{ ...mirror, quo_phone_numbers: { ...mirror.quo_phone_numbers!, quo_phone_number_id: "PN87654321" } }], true)).setup.code).toBe("chat_identity");
  });
  it("changes the readiness fingerprint on real setup/activity changes, not array ordering", async () => {
    const first = await resolveProcessorChat(phone, [], [mirror], true);
    expect((await resolveProcessorChat(phone, [], [mirror], true)).setup.fingerprint).toBe(first.setup.fingerprint);
    expect((await resolveProcessorChat(phone, [], [{ ...mirror, last_message_time: "2026-10-22T16:00:00Z" }], true)).setup.fingerprint).not.toBe(first.setup.fingerprint);
  });
  it("batches repeated technicians into two complete caller reads and surfaces backend failures", async () => {
    const from = vi.fn((table: string) => {
      const builder = { select: () => builder, or: () => builder, order: () => builder, range: async () => ({ data: table === "technicians" ? [] : [mirror], error: null }) };
      return builder;
    });
    const caller = { from } as unknown as Parameters<typeof readProcessorChats>[0];
    const result = await readProcessorChats(caller, Array(25).fill(phone), true);
    expect(result.size).toBe(1); expect(result.get(phone)?.setup.state).toBe("ready");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["technicians", "quo_conversations"]);
    const failing = { from: () => { const builder = { select: () => builder, or: () => builder, order: () => builder, range: async () => ({ data: null, error: { message: "synthetic outage" } }) }; return builder; } } as unknown as Parameters<typeof readProcessorChats>[0];
    await expect(readProcessorChats(failing, [phone], true)).rejects.toMatchObject({ code: "chat_lookup", retryable: true });
  });
  it("keeps every request small when the board loads hundreds of technicians", async () => {
    const phones = Array.from({ length: 300 }, (_, i) => `415555${String(i).padStart(4, "0")}`);
    const filters: string[] = [];
    const from = vi.fn((table: string) => {
      const builder = { select: () => builder, or: (filter: string) => { filters.push(filter); return builder; }, order: () => builder,
        range: async () => ({ data: table === "technicians" ? [{ phone_number: phones[7], chat_link: null }] : [{ ...mirror, customer_number: `+1${phones[7]}` }], error: null }) };
      return builder;
    });
    const result = await readProcessorChats({ from } as unknown as Parameters<typeof readProcessorChats>[0], phones, true);
    expect(result.size).toBe(300);
    expect(result.get(phones[7])?.setup.state).toBe("ready");
    expect(result.get(phones[8])?.setup.state).toBe("blocked");
    // 300 technicians -> 8 directory + 8 conversation requests, each with at most 40 conditions.
    expect(from.mock.calls.length).toBe(16);
    expect(Math.max(...filters.map((filter) => filter.split(",").length))).toBeLessThanOrEqual(40);
    expect(Math.max(...filters.map((filter) => filter.length))).toBeLessThan(1500);
  });
});
