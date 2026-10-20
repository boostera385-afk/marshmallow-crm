export interface WorkflowInboxDb {
  rpc(name: "workflow_notifications" | "schedule_monitor_admin", args: { p_input: Record<string, unknown> }): PromiseLike<{
    data: unknown; error: { code?: string; message: string } | null;
  }>;
}
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkflowInboxHandler(authenticate: (req: Request) => Promise<{ userId: string; db: WorkflowInboxDb }>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
    try {
      const { userId, db } = await authenticate(req);
      if (!userId) return reply({ error: "Sign in to open your inbox" }, 401);
      const raw = await req.text();
      if (raw.length > 20000) return reply({ error: "Request too large" }, 400);
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || !("area" in body) || !("action" in body) || typeof body.action !== "string") return reply({ error: "Invalid request" }, 400);
      const schedule = body.area === "schedule";
      if ((!schedule && body.area !== "notifications") || !(schedule ? ["status", "configure", "link", "unlink", "retry", "review"] : ["list", "alerts", "read", "open"]).includes(body.action)) return reply({ error: "Invalid action" }, 400);
      const input: Record<string, unknown> = { action: body.action };
      const fields = schedule ? ["mode", "reason", "leadId", "conversationId", "timezone", "offset", "generation", "decision", "expectedChangedAt"] : ["category", "view", "search", "since", "until", "after", "offset", "notificationId", "ids"];
      for (const key of fields) if (key in body) input[key] = Reflect.get(body, key);
      for (const key of ["notificationId", "leadId", "conversationId"]) if (key in input && (typeof input[key] !== "string" || !uuid.test(input[key]))) return reply({ error: "Invalid identifier" }, 400);
      if ("offset" in input && (typeof input.offset !== "number" || !Number.isSafeInteger(input.offset) || input.offset < 0)) return reply({ error: "Invalid page" }, 400);
      if ("generation" in input && (typeof input.generation !== "number" || !Number.isSafeInteger(input.generation) || input.generation < 1)) return reply({ error: "Invalid evidence revision" }, 400);
      if (schedule && body.action !== "status" && (typeof input.reason !== "string" || input.reason.trim().length < 10 || input.reason.length > 2000)) return reply({ error: "Enter a reason (10–2000 characters)" }, 400);
      if ("ids" in input && (!Array.isArray(input.ids) || input.ids.length > 100 || input.ids.some((id: unknown) => typeof id !== "string" || !uuid.test(id)))) return reply({ error: "Select at most 100 notifications" }, 400);
      if (body.action === "read" && !Array.isArray(input.ids)) return reply({ error: "Select notifications to mark read" }, 400);
      if (body.action === "open" && !input.notificationId) return reply({ error: "Notification ID required" }, 400);
      if (body.action === "alerts" && (typeof input.after !== "string" || !Number.isFinite(Date.parse(input.after)))) return reply({ error: "Alert cursor required" }, 400);
      for (const key of ["since", "until"]) if (input[key] && (typeof input[key] !== "string" || !Number.isFinite(Date.parse(input[key])))) return reply({ error: "Invalid date" }, 400);
      const { data, error } = await db.rpc(schedule ? "schedule_monitor_admin" : "workflow_notifications", { p_input: input });
      if (error) return reply({ error: ["42501", "22023", "40001"].includes(error.code ?? "") ? error.message : "Inbox unavailable. Ask Admin to check backend installation." }, error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "40001" ? 409 : 503);
      return reply(data);
    } catch (error) {
      return reply({ error: error instanceof SyntaxError ? "Invalid JSON request" : "Inbox unavailable. Try again." }, error instanceof SyntaxError ? 400 : 503);
    }
  };
}
