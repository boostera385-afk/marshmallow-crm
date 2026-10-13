import { test, expect, type Page } from "@playwright/test";
import { createCopilotHandler } from "../../supabase/functions/_shared/copilot-handler";
import type { CopilotRole } from "../../supabase/functions/_shared/copilot-core";
import { readFileSync } from "node:fs";

const extensionRelease: { version: string } = JSON.parse(readFileSync(new URL("../../public/extension-release.json", import.meta.url), "utf8"));

const USER = "00000000-0000-4000-8000-000000000001";
const RECORD = "00000000-0000-4000-8000-000000000002";
const lead = { id: RECORD, job_id: "MM-101", customer_name: "Synthetic Customer", customer_phone: "5550100000", status: "urgent_job",
  service_type: "Plumbing", service_details: "Synthetic repair", address: "10 Test St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
  customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00", quote: "PRIVATE QUOTE", show_quote_to_opr: false,
  created_at: "2026-10-13T05:00:00Z", created_by: USER, tech_name: "Synthetic Tech", tech_number: "5550100001" };
async function isolatedCopilot(page: Page, role: CopilotRole = "admin", options: { allowed?: boolean; failedAsk?: boolean; aiFailure?: boolean; configureFailure?: boolean } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const questions: Record<string, unknown>[] = [];
  let permitted = options.allowed ?? true;
  const config = { enabled: true, ai_enabled: Boolean(options.aiFailure), monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" };
  const roles = ["processor", "customer_service", "cs_admin", "opr", "opr_admin"].map((r) => ({ role: r, allowed: false }));
  const users: { user_id: string; allowed: boolean }[] = [];
  const handler = createCopilotHandler({
    authenticate: async () => ({ userId: USER, db: { rpc: async (name, args) => {
      calls.push({ name, args });
      const success = (data: unknown) => ({ data, error: null });
      if (name === "copilot_get_access") return success({ allowed: permitted && config.enabled, aiEnabled: permitted && config.enabled && config.ai_enabled, role, timezone: config.timezone,
        sections: role === "admin" ? ["leads", "schedule", "technicians", "settings"] : ["leads"] });
      if (["copilot_get_settings", "copilot_usage_summary", "copilot_set_permission", "copilot_configure"].includes(name) && role !== "admin") return { data: null, error: { code: "42501", message: "Only Admin may manage Copilot" } };
      if (name === "copilot_get_settings") return success({ config, roles, users });
      if (name === "copilot_usage_summary") return success({ requests: 0, reservedCents: 0, inputTokens: 0, outputTokens: 0, unavailable: 0 });
      if (name === "copilot_set_permission") {
        if (args?.p_role) roles.find((r) => r.role === args.p_role)!.allowed = args.p_allowed === true;
        if (args?.p_user_id) { users.splice(0); if (args.p_allowed !== null) users.push({ user_id: String(args.p_user_id), allowed: args.p_allowed === true }); }
        return success(null);
      }
      if (name === "copilot_configure") {
        if (options.configureFailure) return { data: null, error: { code: "42501", message: "Synthetic configuration denial" } };
        Object.assign(config, { enabled: args?.p_enabled, ai_enabled: args?.p_ai_enabled, monthly_budget_cents: args?.p_monthly_budget_cents,
          daily_ai_limit: args?.p_daily_ai_limit, timezone: args?.p_timezone });
        return success(null);
      }
      if (name === "copilot_search") {
        if (options.failedAsk) return { data: null, error: { message: "Synthetic backend failure" } };
        if (args?.p_kind === "technicians") return success([{ id: RECORD, name: "Synthetic Tech", phone_number: "5550100001", service: "Plumbing", area: "Miami", is_active: true, is_good_tech: true, opr_code: "OPR1" }]);
        return success([{ ...lead, quote: role === "opr" || role === "opr_admin" ? null : lead.quote }]);
      }
      if (name === "copilot_report") return success({ start: args?.p_start, end: args?.p_end, timezone: config.timezone,
        metrics: { created: 1, latestEdits: 0, scheduled: 1, urgent: 1, incomplete: 0, needTech: 0, followups: 0 } });
      return success(null);
    } } }),
    budgetDb: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null }; } }),
    aiConfigured: () => true,
    generate: async () => { throw new Error("Synthetic provider failure; no provider request is made"); },
  });
  await page.context().routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (url.pathname.endsWith("/functions/v1/marshmallow-copilot")) {
      const body = route.request().postDataJSON();
      if (body.action === "ask") questions.push(body);
      const result = await handler(new Request("https://synthetic.invalid/copilot", { method: route.request().method(), body: route.request().postData() ?? undefined }));
      return route.fulfill({ status: result.status, body: await result.text(), headers: Object.fromEntries(result.headers.entries()) });
    }
    let data: unknown = [];
    const endpoint = url.pathname.split("/").pop();
    if (url.pathname.startsWith("/auth/v1/")) data = { id: USER, email: "synthetic@example.invalid" };
    else if (endpoint === "profiles" || endpoint === "profiles_public") data = [{ id: USER, full_name: "Synthetic User", email: "synthetic@example.invalid", opr_code: "OPR1" }, ...(!url.searchParams.has("id") ? [{ id: RECORD, full_name: "Synthetic Operator" }] : [])];
    else if (endpoint === "user_roles") data = url.searchParams.get("select") === "user_id,role" ? [{ user_id: USER, role }, { user_id: RECORD, role: "opr" }] : [{ user_id: USER, role }];
    else if (endpoint === "leads") data = [lead];
    else if (endpoint === "technicians") data = [{ id: RECORD, name: "Synthetic Tech", area: "Miami", service: "Plumbing", phone_number: "5550100001", is_active: true, is_good_tech: true, opr_code: "OPR1" }];
    else if (endpoint === "get_lead_status_counts") data = [{ status: "urgent_job", count: 1 }];
    else if (endpoint === "get_lead_copy_access") data = false;
    else if (endpoint === "get_lead_copy_settings") data = { roles: [], users: [] };
    else if (endpoint === "get_operator_hold_alerts") data = { observed_at: "2026-10-13T05:00:00Z", unread_count: 0, alerts: [] };
    if (route.request().headers().accept?.includes("application/vnd.pgrst.object+json") && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ json: data, headers: { "access-control-allow-origin": "*", "content-range": "0-0/1" } });
  });
  await page.addInitScript(({ id, extensionVersion }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-kxiqholnmhkwhdkhtopp-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800,
      expires_in: 3600, token_type: "bearer", user: { id, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated" } }));
    localStorage.setItem("auth_verified_user_id", id);
    // Keep the unrelated, hover-paused first-visit Donut notice from covering
    // Copilot controls. The real notification behavior is unchanged.
    localStorage.setItem(`donut-release-notice:${id}:${extensionVersion}`, "shown");
  }, { id: USER, extensionVersion: extensionRelease.version });
  return { calls, questions, revoke: () => { permitted = false; } };
}

for (const width of [1920, 1366, 1024, 390]) test(`Copilot fits ${width}px and keyboard close restores focus`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = await isolatedCopilot(page);
  await page.goto("/leads");
  const launcher = page.getByRole("button", { name: "Ask Marshmallow Copilot", exact: true });
  await expect(launcher).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Marshmallow Copilot" })).toHaveCount(0);
  await launcher.click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await expect(panel.getByRole("heading", { name: "How may I help you today?" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toBeFocused();
  await panel.getByRole("button", { name: "Find a lead", exact: true }).click();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("MM-101");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByText("10 Test St Apt 2, Miami, FL, 33101")).toBeVisible();
  await expect(panel.getByText("CRM result · No AI")).toBeVisible();
  expect(fixture.calls.some((c) => c.name === "copilot_reserve_ai")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const bounds = await panel.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(width);
  if (width === 1366) await page.screenshot({ path: test.info().outputPath("copilot-desktop.png") });
  await page.keyboard.press("Escape"); await expect(panel).not.toBeVisible(); await expect(launcher).toBeFocused();
  await launcher.click(); await expect(panel.getByRole("heading", { name: "How may I help you today?" })).toBeVisible();
  await expect(panel.getByText("Synthetic Customer")).toHaveCount(0);
});

test("Excluded user gets no launcher or command-menu entry", async ({ page }) => {
  await isolatedCopilot(page, "opr", { allowed: false }); await page.goto("/leads");
  await expect(page.getByText("Synthetic Customer").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Marshmallow Copilot" })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Type a command or search...")).toBeVisible();
  await expect(page.getByText("Ask Marshmallow Copilot")).toHaveCount(0);
});
test("Command menu opens Copilot without replacing Ctrl+K navigation", async ({ page }) => {
  await isolatedCopilot(page); await page.goto("/leads");
  await expect(page.getByRole("button", { name: "Ask Marshmallow Copilot" })).toBeVisible();
  await page.keyboard.press("Control+k"); await page.getByRole("option", { name: "Ask Marshmallow Copilot" }).click();
  await expect(page.getByRole("dialog", { name: "Marshmallow Copilot" })).toBeVisible();
});
