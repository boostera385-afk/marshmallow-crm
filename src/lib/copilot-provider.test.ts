import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopilotGenerator } from "../../supabase/functions/_shared/copilot-provider";
const completed = (answer = { kind: "answer", query: "", text: "A heat pump transfers heat." }) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }], usage: { input_tokens: 204, output_tokens: 31 } });
afterEach(() => vi.useRealTimers());
describe("Copilot Responses provider adapter (network mocked)", () => {
  it("requests strict nonstored output and parses actual usage", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify(completed())));
    const answer = await createCopilotGenerator(() => "synthetic", transport)("What is a heat pump?", "Counts only", [{ question: "Earlier question", answer: "Earlier answer" }]);
    expect(answer).toMatchObject({ text: "A heat pump transfers heat.", inputTokens: 204, outputTokens: 31 });
    expect(transport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(transport.mock.calls[0][1].body);
    expect(transport.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ store: false, model: "gpt-4o-mini", max_output_tokens: 600, text: { format: { type: "json_schema", strict: true } } });
    expect(body.input).toHaveLength(4); expect(body.instructions).toContain("untrusted");
  });
  it.each([
    [401, {}, "provider_auth"], [403, {}, "provider_auth"], [400, {}, "provider_configuration"], [404, {}, "provider_configuration"], [429, { error: { code: "insufficient_quota" } }, "provider_billing"],
    [429, {}, "provider_rate_limit"], [500, {}, "provider_unavailable"],
    [200, { status: "incomplete", output: [] }, "provider_incomplete"],
    [200, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "private echoed prompt" }] }] }, "provider_refusal"],
    [200, { status: "completed", output: [] }, "provider_invalid"],
  ])("classifies status %s safely as %s without paid retries", async (status, body, code) => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    await expect(createCopilotGenerator(() => "synthetic", transport)("PRIVATE INPUT")).rejects.toMatchObject({ code });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown token counts null, not invented zero", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...completed(), usage: undefined })));
    expect(await createCopilotGenerator(() => "synthetic", transport)("hello")).toMatchObject({ inputTokens: null, outputTokens: null });
  });
  it("uses a benchmark override only when supplied by a trusted server caller", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify(completed())));
    await createCopilotGenerator(() => "synthetic", transport, "synthetic-review-model")("hello");
    expect(JSON.parse(transport.mock.calls[0][1].body).model).toBe("synthetic-review-model");
  });
  it("aborts after 20 seconds and returns an actionable timeout", async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = createCopilotGenerator(() => "synthetic", transport)("hello");
    const assertion = expect(pending).rejects.toMatchObject({ code: "provider_timeout" });
    await vi.advanceTimersByTimeAsync(20000); await assertion; expect(transport).toHaveBeenCalledTimes(1);
  });
});
