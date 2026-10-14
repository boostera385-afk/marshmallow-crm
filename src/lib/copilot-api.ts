import { z } from "zod";
import { FunctionsFetchError, FunctionsRelayError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { COPILOT_ROLES, parseCopilotAccess, safeCopilotHref, type CopilotAsk, type CopilotConfig, type CopilotSettings, type CopilotResult } from "../../supabase/functions/_shared/copilot-core";
export { accessibleFeatures, businessDate, reportRange, resolveCopilotAccess, routeCopilotMessage, safeCopilotHref } from "../../supabase/functions/_shared/copilot-core";
export type { CopilotAccess, CopilotAsk, CopilotConfig, CopilotResult, CopilotSettings, CopilotDiagnostics, CopilotSearchContext } from "../../supabase/functions/_shared/copilot-core";

const usageSchema = z.object({ requests: z.number(), reservedCents: z.number(), inputTokens: z.number(), outputTokens: z.number(), unavailable: z.number() });
const settingsSchema = z.object({
  config: z.object({ enabled: z.boolean(), ai_enabled: z.boolean(), monthly_budget_cents: z.number().int().min(0), daily_ai_limit: z.number().int().min(0), timezone: z.string() }),
  roles: z.array(z.object({ role: z.enum(COPILOT_ROLES), allowed: z.boolean() })),
  users: z.array(z.object({ user_id: z.string().uuid(), allowed: z.boolean() })), usage: usageSchema,
});
const hrefSchema = z.string().refine(safeCopilotHref, "Invalid Copilot destination");
const followupSchema = z.object({ intent: z.enum(["leads", "technicians", "report"]), query: z.string().optional(), status: z.string().optional(), service: z.string().optional(), area: z.string().optional(), active: z.boolean().nullable().optional(), date: z.string().optional(), start: z.string().optional(), end: z.string().optional(), scope: z.enum(["mine", "team"]).optional() });
const diagnosticsSchema = z.object({ configChangedAt: z.string().nullable(), lastSuccessAt: z.string().nullable(), remainingCents: z.number(), remainingToday: z.number(), completedThisMonth: z.number(), keyConfigured: z.boolean(), backendVersion: z.string(), model: z.string(), promptVersion: z.string() });
export const copilotResultSchema = z.object({
  source: z.enum(["crm", "ai"]), title: z.string(), text: z.string(),
  cards: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), href: hrefSchema, fields: z.array(z.object({ label: z.string(), value: z.string() })) })),
  links: z.array(z.object({ label: z.string(), href: hrefSchema })),
  metrics: z.array(z.object({ label: z.string(), value: z.number().nullable(), description: z.string() })),
  hasMore: z.boolean(), nextOffset: z.number().int().min(0),
  searchQuery: z.string().optional(),
  aiUsed: z.boolean().optional(),
  filters: z.array(z.object({ label: z.string(), value: z.string() })).optional(), requestId: z.string().optional(), noticeCode: z.string().optional(), followup: followupSchema.optional(),
  resolvedIntent: z.enum(["features", "help", "leads", "technicians", "attention", "report", "health", "ai", "explain_report", "blocked", "brief", "daily_brief", "clarify"]), refreshedAt: z.string(),
});
export class CopilotApiError extends Error { constructor(message: string, public status?: number, public code?: string, public requestId?: string) { super(message); } }
async function call(body: object, signal?: AbortSignal): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("marshmallow-copilot", { body, signal });
  if (error) {
    if (error instanceof FunctionsFetchError) throw new CopilotApiError("Cannot reach Copilot. Check your connection; no automatic AI retry was made.", undefined, "edge_network");
    if (error instanceof FunctionsRelayError) throw new CopilotApiError("The Copilot gateway could not complete the request. No automatic AI retry was made.", undefined, "edge_gateway");
    let message = "Copilot is unavailable. Ask Admin to check its migration and Edge Function deployment.";
    const context: unknown = "context" in error ? error.context : undefined;
    if (context instanceof Response) {
      if (context.status === 401) message = "Your sign-in session was not accepted. Sign in again before using Copilot.";
      const payload: unknown = await context.clone().json().catch(() => null);
      if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") message = payload.error;
      const details = payload && typeof payload === "object" ? payload : {};
      throw new CopilotApiError(message, context.status, "code" in details && typeof details.code === "string" ? details.code : undefined, "requestId" in details && typeof details.requestId === "string" ? details.requestId : undefined);
    }
    throw new CopilotApiError(message);
  }
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") throw new CopilotApiError(data.error);
  return data;
}
export const fetchCopilotAccess = async (signal?: AbortSignal) => parseCopilotAccess(await call({ action: "access" }, signal));
// Zod validates the complete external envelope. Explicit contract assertions are
// needed because this app disables strictNullChecks (Zod infers optional fields).
// No casts are used to invent generated database tables or RPC signatures.
export const fetchCopilotSettings = async () => settingsSchema.parse(await call({ action: "settings" })) as CopilotSettings;
export const setCopilotPermission = async (role: string | null, userId: string | null, allowed: boolean | null) => z.object({ saved: z.literal(true) }).parse(await call({ action: "set_permission", role, userId, allowed }));
export const configureCopilot = async (config: CopilotConfig, expected?: CopilotConfig) => z.object({ saved: z.literal(true) }).parse(await call({ action: "configure", config, expected }));
export const askCopilot = async (ask: CopilotAsk, signal?: AbortSignal) => copilotResultSchema.parse(await call(ask, signal)) as CopilotResult;
export const fetchCopilotDiagnostics = async () => diagnosticsSchema.parse(await call({ action: "diagnostics" }));
export const testCopilotAi = async () => copilotResultSchema.parse(await call({ action: "test_ai", confirmed: true, requestId: crypto.randomUUID() })) as CopilotResult;
