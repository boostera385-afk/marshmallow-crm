type RpcArgs = { p_input: Record<string, unknown> };
export interface CxUpdateDb {
  rpc(name: "workflow_requests", args: RpcArgs): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = ["list_pending", "list_updated", "list_action", "list_resolved", "get", "count", "counts", "owners", "create", "complete", "resolve", "acknowledge", "question_more", "reassign"];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

export function createCxUpdateHandler(authenticate: (req: Request) => Promise<{ userId: string; db: CxUpdateDb }>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return json({ error: "Use POST" }, 405);
    try {
      const { userId, db } = await authenticate(req);
      if (!userId) return json({ error: "Sign in to access update requests" }, 401);
      const raw = await req.text();
      if (raw.length > 12000) return json({ error: "Request too large" }, 400);
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || !("kind" in body) || (body.kind !== "cx" && body.kind !== "tech") ||
        !("action" in body) || typeof body.action !== "string" || !actions.includes(body.action)) {
        return json({ error: "Invalid update request action" }, 400);
      }
      const leadId = "leadId" in body ? body.leadId : null;
      const requestId = "requestId" in body ? body.requestId : null;
      const text = "text" in body ? body.text : null;
      const offset = "offset" in body ? body.offset : 0;
      const revision = "revision" in body ? body.revision : null;
      const ownerId = "ownerId" in body ? body.ownerId : null;
      if ((leadId !== null && (typeof leadId !== "string" || !uuid.test(leadId))) ||
        (requestId !== null && (typeof requestId !== "string" || !uuid.test(requestId))) ||
        (text !== null && (typeof text !== "string" || text.length > 4000)) ||
        typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 ||
        (revision !== null && (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)) ||
        (ownerId !== null && (typeof ownerId !== "string" || !uuid.test(ownerId)))) return json({ error: "Invalid request fields" }, 400);
      if ((body.action === "create" && (!leadId || !requestId || typeof text !== "string" || !text.trim() || text.trim().length > 2000)) ||
        (["complete", "question_more", "reassign"].includes(body.action) && (!requestId || typeof text !== "string" || !text.trim())) ||
        (["resolve", "acknowledge", "get"].includes(body.action) && !requestId) ||
        (body.action === "reassign" && !ownerId) ||
        (["complete", "question_more", "resolve", "acknowledge", "reassign"].includes(body.action) && revision === null)) return json({ error: "Request ID, current revision and update details are required. Refresh the page." }, 400);
      const { data, error } = await db.rpc("workflow_requests", { p_input: {
        kind: body.kind, action: body.action, leadId, requestId, text, offset, revision, ownerId,
      } });
      if (error) {
        if (error.code === "42501") return json({ error: error.message }, 403);
        if (error.code === "23505" || error.code === "40001") return json({ error: error.message }, 409);
        if (error.code === "22023") return json({ error: error.message }, 400);
        console.error("workflow_requests rpc failed", { kind: body.kind, action: body.action, code: error.code ?? null });
        return json({ error: `Update requests are unavailable (code ${error.code ?? "unknown"}). Try again shortly.`, code: error.code ?? null }, 503);
      }
      return json(data);
    } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid JSON request" : "Update requests are unavailable. Try again." }, error instanceof SyntaxError ? 400 : 503);
    }
  };
}
