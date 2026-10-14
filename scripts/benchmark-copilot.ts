// Optional LIVE provider benchmark. Not run by tests/build and never touches CRM.
// Requires explicit spend confirmation and a server-side environment credential.
import { COPILOT_EVALUATION_CASES } from "../supabase/functions/_shared/copilot-evaluation.ts";
import { COPILOT_MODEL, COPILOT_PROMPT_VERSION, CopilotProviderError, createCopilotGenerator } from "../supabase/functions/_shared/copilot-provider.ts";

if (!Deno.args.includes("--confirm-provider-spend")) {
  console.info("Not run: pass --confirm-provider-spend only after approval. This makes up to 5 paid provider requests with synthetic data, outside the CRM allowance. Verify model access/pricing and provider spend controls first.");
  Deno.exit(0);
}
const model = Deno.args.find((arg) => arg.startsWith("--model="))?.slice(8) ?? COPILOT_MODEL;
if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error("Invalid model identifier");
if (!Deno.env.get("OPENAI_API_KEY")?.trim()) throw new Error("A server-side OPENAI_API_KEY is required. Never pass it as a command argument.");
const generate = createCopilotGenerator(() => Deno.env.get("OPENAI_API_KEY"), fetch, model);
for (const scenario of COPILOT_EVALUATION_CASES) {
  const start = performance.now();
  try {
    const answer = await generate(scenario.question, scenario.context);
    console.info(JSON.stringify({ scenario: scenario.id, model, promptVersion: COPILOT_PROMPT_VERSION,
      durationMs: Math.round(performance.now() - start), inputTokens: answer.inputTokens, outputTokens: answer.outputTokens,
      kindMatches: answer.kind === scenario.expectedKind, answer: answer.text, query: answer.query, humanReview: scenario.review }));
  } catch (error) {
    // Stop on first provider failure. No automatic retries or continued spending.
    console.error(JSON.stringify({ scenario: scenario.id, model, code: error instanceof CopilotProviderError ? error.code : "benchmark_unavailable" }));
    Deno.exit(1);
  }
}
console.info("Benchmark finished. Review every answer, safety outcome, latency and current token prices before changing the production model/reservation. Kind matches alone are not a quality score.");
