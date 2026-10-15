// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readProcessorHistory } from "../../supabase/functions/_shared/processor-history";
const options = { chatLink: "https://my.quo.com/inbox/PN12345678/c/CN12345678", phone: "4155550199", since: "2026-10-01T00:00:00Z", apiKey: "synthetic-key" };
const item = (id: string, overrides = {}) => ({ id, conversationId: "CN12345678", phoneNumberId: "PN12345678", direction: "incoming", text: "JOB-1001 is completed", createdAt: "2026-10-15T16:00:00Z", ...overrides });
describe("Complete technician history pagination", () => {
  it("reads beyond the old 250-message limit, deduplicates and isolates the exact chat", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: Array.from({ length: 250 }, (_, i) => item(`m${i}`)), nextPageToken: "page2" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [item("last"), item("m0"), item("wrong", { conversationId: "CNother" }), item("wrongline", { conversationId: "CNother", phoneNumberId: "PNother" })], nextPageToken: null }) });
    const messages = await readProcessorHistory({ ...options, fetcher });
    expect(messages).toHaveLength(251);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("pageToken=page2");
    expect(messages.some((m) => m.id.startsWith("wrong"))).toBe(false);
  });
  it("does not turn a second-page failure into a complete-history review", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [item("1")], nextPageToken: "page2" }) }).mockResolvedValueOnce({ ok: false });
    await expect(readProcessorHistory({ ...options, fetcher })).rejects.toThrow("unavailable");
  });
  it("rejects repeated pagination rather than looping or silently dropping history", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], nextPageToken: "same" }) });
    await expect(readProcessorHistory({ ...options, fetcher })).rejects.toThrow("pagination repeated");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps media replies as response events and excludes pre-job messages", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [item("media", { text: null }), item("old", { createdAt: "2026-01-01T00:00:00Z" })], nextPageToken: null }) });
    expect(await readProcessorHistory({ ...options, fetcher })).toEqual([expect.objectContaining({ id: "media", text: null })]);
  });
  it("fails closed for missing pagination or line identity rather than claiming complete silence", async () => {
    for (const payload of [{ data: [] }, { data: [item("unknown-line", { phoneNumberId: null })], nextPageToken: null }]) {
      const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
      await expect(readProcessorHistory({ ...options, fetcher })).rejects.toThrow();
    }
  });
});
