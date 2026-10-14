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
async function isolatedCopilot(page: Page, role: CopilotRole = "admin", options: { allowed?: boolean; failedAsk?: boolean; aiFailure?: boolean; aiSuccess?: boolean; configureFailure?: boolean } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const questions: Record<string, unknown>[] = [];
  let permitted = options.allowed ?? true;
  const config = { enabled: true, ai_enabled: Boolean(options.aiFailure || options.aiSuccess), monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" };
  const generated: { question: string; context?: string; history?: { question: string; answer: string }[] }[] = [];
  const roles = ["processor", "customer_service", "cs_admin", "opr", "opr_admin"].map((r) => ({ role: r, allowed: false }));
  const users: { user_id: string; allowed: boolean }[] = [];
  const handler = createCopilotHandler({
    authenticate: async () => ({ userId: USER, db: { rpc: async (name, args) => {
      calls.push({ name, args });
      const success = (data: unknown) => ({ data, error: null });
      if (name === "copilot_get_access") return success({ allowed: permitted && config.enabled, aiEnabled: permitted && config.enabled && config.ai_enabled, role, timezone: config.timezone,
        sections: role === "admin" ? ["leads", "schedule", "technicians", "settings"] : ["leads"] });
       if (["copilot_get_settings", "copilot_usage_summary", "copilot_set_permission", "copilot_configure", "copilot_configure_checked", "copilot_diagnostics"].includes(name) && role !== "admin") return { data: null, error: { code: "42501", message: "Only Admin may manage Copilot" } };
      if (name === "copilot_get_settings") return success({ config, roles, users });
      if (name === "copilot_usage_summary") return success({ requests: 0, reservedCents: 0, inputTokens: 0, outputTokens: 0, unavailable: 0 });
      if (name === "copilot_set_permission") {
        if (args?.p_role) roles.find((r) => r.role === args.p_role)!.allowed = args.p_allowed === true;
        if (args?.p_user_id) { users.splice(0); if (args.p_allowed !== null) users.push({ user_id: String(args.p_user_id), allowed: args.p_allowed === true }); }
        return success(null);
      }
       if (name === "copilot_configure" || name === "copilot_configure_checked") {
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
       if (name === "copilot_lead_brief") return success({ ...lead, quote: role === "opr" || role === "opr_admin" ? null : lead.quote, tech_name: role === "cs_admin" ? null : lead.tech_name });
       if (name === "copilot_diagnostics") return success({ configChangedAt: null, lastSuccessAt: null, remainingCents: 1000, remainingToday: 20, completedThisMonth: 0 });
      return success(null);
    } } }),
    budgetDb: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null }; } }),
    aiConfigured: () => true,
    generate: async (question, context, history) => { generated.push({ question, context, history }); if (options.aiSuccess) return { kind: "answer", query: "", text: "Synthetic draft: Please confirm the next step. [Agreed schedule]", inputTokens: 100, outputTokens: 20 }; throw new Error("Synthetic provider failure; no provider request is made"); },
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
  return { calls, questions, generated, revoke: () => { permitted = false; } };
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
test("OPR search retains hidden quote and exposes no technician search mode", async ({ page }) => {
  await isolatedCopilot(page, "opr"); await page.goto("/leads");
  await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("find lead MM-101");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByText(/MM-101 · Synthetic Customer/)).toBeVisible();
  await expect(panel.getByText("PRIVATE QUOTE")).toHaveCount(0);
  await expect(panel.getByRole("option", { name: "Find technicians" })).toHaveCount(0);
});
test("Technician result deep-links to a scoped saved ID", async ({ page }) => {
  await isolatedCopilot(page); await page.goto("/leads");
  await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("button", { name: "Find a technician" }).click();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("Synthetic Tech");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  const selected = page.waitForRequest((req) => { const url = new URL(req.url()); return url.pathname.endsWith("/technicians") && url.searchParams.get("id") === `eq.${RECORD}`; });
  await panel.getByRole("button", { name: "Open technician", exact: true }).click();
  await selected; await expect(page).toHaveURL(new RegExp(`/technicians\\?copilot=${RECORD}`));
  await expect(page.getByText("Showing the technician selected in Copilot.", { exact: false })).toBeVisible();
});
test("Backend failure produces an error, not invented results or automatic retries", async ({ page }) => {
  const fixture = await isolatedCopilot(page, "admin", { failedAsk: true }); await page.goto("/leads");
  await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("find lead MM-101");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByRole("alert")).toContainText("could not be completed"); expect(fixture.questions).toHaveLength(1);
  await expect(panel.getByRole("button", { name: "Open lead", exact: true })).toHaveCount(0);
});
test("AI failure is bounded, explicit and never automatically retried", async ({ page }) => {
  const fixture = await isolatedCopilot(page, "admin", { aiFailure: true }); await page.goto("/leads");
  await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
   await panel.getByRole("switch", { name: "Allow AI-assisted mode" }).click();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("What is a heat pump?");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByRole("alert")).toContainText("AI is unavailable");
  expect(fixture.calls.filter((c) => c.name === "copilot_reserve_ai")).toHaveLength(1); expect(fixture.questions).toHaveLength(1);
});
test("Admin manages role default, searchable override and explicit global switch", async ({ page }) => {
  const fixture = await isolatedCopilot(page); await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  // PR #127 now owns matrix rendering inside the copy settings panel. Keep
  // both permission systems searchable in a single matrix after merging main.
  await expect(page.getByRole("table")).toHaveCount(1);
  await page.getByLabel("Find feature", { exact: true }).fill("copy complete details");
  await expect(page.getByRole("table").getByRole("columnheader", { name: "Copy All Details", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByRole("combobox", { name: "Copy All Details override for Synthetic Operator", exact: true })).toBeEnabled();
  await page.getByLabel("Find feature", { exact: true }).fill("copilot");
  await expect(page.getByRole("table").getByRole("columnheader", { name: "Marshmallow Copilot", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByRole("switch", { name: "Marshmallow Copilot for Synthetic Operator", exact: true })).toBeEnabled();
  await page.getByLabel("Find feature", { exact: true }).fill("");
  const control = page.getByRole("switch", { name: "Allow Copilot for Operator", exact: true });
  await expect(control).not.toBeChecked(); await control.click(); await expect(control).toBeChecked();
  await page.getByRole("button", { name: "Copilot user overrides" }).click();
  await page.getByLabel("Find Copilot user", { exact: true }).fill("Synthetic Operator");
  await page.getByRole("combobox", { name: "Copilot override for Synthetic Operator" }).click();
  await page.getByRole("option", { name: "Deny", exact: true }).click();
  await expect(page.getByText("Effective access: Denied", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Enable Marshmallow Copilot globally" }).click();
   expect(fixture.calls.some((c) => c.name === "copilot_configure_checked")).toBe(false);
  await page.getByRole("button", { name: "Save Copilot configuration" }).click();
  await expect(page.getByRole("button", { name: "Ask Marshmallow Copilot" })).toHaveCount(0);
});

test("Admin AI edits survive permission refresh and apply only after Save", async ({ page }) => {
  const fixture = await isolatedCopilot(page); await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  const ai = page.getByRole("switch", { name: "Enable Copilot AI", exact: true });
  await ai.click();
  await page.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }).fill("5.25");
  await page.getByRole("spinbutton", { name: "AI requests per user / day" }).fill("4");
  const role = page.getByRole("switch", { name: "Allow Copilot for Operator", exact: true });
  await role.click(); await expect(role).toBeChecked(); await expect(role).toBeEnabled();
  await expect(ai).toBeChecked(); await expect(page.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" })).toHaveValue("5.25");
   expect(fixture.calls.some((c) => c.name === "copilot_configure_checked")).toBe(false);
  await expect(page.getByText(/There is no separate per-user AI permission/)).toBeVisible();
  await page.getByRole("button", { name: "Save Copilot configuration" }).click();
   await expect.poll(() => fixture.calls.filter((c) => c.name === "copilot_configure_checked")).toHaveLength(1);
   expect(fixture.calls.find((c) => c.name === "copilot_configure_checked")?.args).toEqual({ p_enabled: true, p_ai_enabled: true, p_monthly_budget_cents: 525, p_daily_ai_limit: 4, p_timezone: "America/New_York", p_expected: { enabled: true, ai_enabled: false, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" } });
  await page.goto("/leads"); await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
   await expect(panel.getByRole("switch", { name: "Allow AI-assisted mode" })).not.toBeChecked();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("find lead MM-101");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByText("CRM result · No AI")).toBeVisible();
  expect(fixture.calls.some((c) => c.name === "copilot_reserve_ai")).toBe(false);
});

test("Failed Admin AI configuration does not enable AI or claim success", async ({ page }) => {
  const fixture = await isolatedCopilot(page, "admin", { configureFailure: true }); await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByRole("switch", { name: "Enable Copilot AI", exact: true }).click();
  await page.getByRole("button", { name: "Save Copilot configuration" }).click();
  await expect(page.getByText("You do not have access to this Copilot feature.", { exact: true })).toBeVisible();
  await expect(page.getByText("Marshmallow Copilot settings saved", { exact: true })).toHaveCount(0);
  await page.goto("/leads"); await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
   await expect(page.getByRole("dialog", { name: "Marshmallow Copilot" }).getByRole("switch", { name: "Allow AI-assisted mode" })).toHaveCount(0);
  expect(fixture.calls.some((c) => c.name === "copilot_reserve_ai")).toBe(false);
});

test("Natural language refinement retains interpreted service and area without AI", async ({ page }) => {
  const fixture = await isolatedCopilot(page); await page.goto("/leads"); await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("Find urgent plumbing leads in Miami");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByLabel("Interpreted filters")).toContainText("Miami");
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("only tomorrow");
  await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByLabel("Interpreted filters").last()).toContainText("Scheduled:");
  const searches = fixture.calls.filter((c) => c.name === "copilot_search");
  expect(searches.at(-1)?.args).toMatchObject({ p_area: "Miami", p_service: "plumbing", p_status: "urgent_job", p_query: "" });
  expect(fixture.generated).toHaveLength(0);
});

test("Selected lead brief stays scoped; drafting waits for AI consent and never sends", async ({ page }) => {
  const fixture = await isolatedCopilot(page, "opr", { aiSuccess: true }); await page.goto("/leads"); await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("find lead MM-101"); await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await panel.getByRole("button", { name: "Lead brief", exact: true }).click(); await expect(panel.getByText("Saved lead brief", { exact: true })).toBeVisible();
  await expect(panel.getByText("PRIVATE QUOTE")).toHaveCount(0);
  await panel.getByRole("button", { name: "Draft follow-up", exact: true }).last().click();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue(/Draft a professional/); expect(fixture.generated).toHaveLength(0);
  await panel.getByRole("switch", { name: "Allow AI-assisted mode" }).click(); await panel.getByRole("button", { name: "Send Copilot question" }).click();
  await expect(panel.getByText(/Synthetic draft:/)).toBeVisible(); expect(fixture.generated).toHaveLength(1);
  expect(fixture.generated[0].context).toContain("Plumbing"); expect(fixture.generated[0].context).not.toContain("PRIVATE"); expect(fixture.generated[0].context).not.toContain("Test St");
  expect(fixture.calls.every((c) => !/send|update|approve/.test(c.name))).toBe(true);
});

test("Admin readiness is a no-spend check and provider test requires confirmation", async ({ page }) => {
  const fixture = await isolatedCopilot(page, "admin", { aiSuccess: true }); await page.goto("/settings"); await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByRole("button", { name: "Check AI readiness" }).click(); await expect(page.getByText("Present · not validated")).toBeVisible(); expect(fixture.generated).toHaveLength(0);
  await page.getByRole("button", { name: "Test AI connection" }).click(); await expect(page.getByRole("alertdialog")).toContainText("$0.02"); expect(fixture.generated).toHaveLength(0);
  await page.getByRole("button", { name: "Confirm AI test" }).click(); await expect(page.getByText("Provider test completed successfully.")).toBeVisible();
  expect(fixture.generated).toHaveLength(1); expect(fixture.generated[0].question).toContain("heat pump");
});

test("Expanded workspace, daily work brief and Enter composer work on a narrow desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 }); const fixture = await isolatedCopilot(page); await page.goto("/leads");
  await page.getByRole("button", { name: "Ask Marshmallow Copilot" }).click(); const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("button", { name: "Expand Copilot" }).click(); await expect(panel.getByText(/Operational workspace/)).toBeVisible();
  await panel.getByLabel("Copilot workspace tools").getByRole("button", { name: "Daily work brief", exact: true }).click(); await expect(panel.getByText("Your daily work brief", { exact: true })).toBeVisible();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("only reliable"); await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).press("Enter");
  await expect(panel.getByText("A little more detail")).toBeVisible(); expect(fixture.generated).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("copilot-pilot-workspace.png") });
});

for (const width of [1366, 390]) test(`Minimized Copilot preserves its session and frees the work page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const fixture = await isolatedCopilot(page); await page.goto("/leads");
  const launcher = page.getByRole("button", { name: "Ask Marshmallow Copilot", exact: true }); await launcher.click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("find lead MM-101");
  await panel.getByRole("button", { name: "Send Copilot question" }).click(); await expect(panel.getByText("MM-101 · Synthetic Customer", { exact: true })).toBeVisible();
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("Keep this unsent draft");
  await panel.getByRole("button", { name: "Minimize Copilot" }).click(); await expect(panel).toHaveCount(0);
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  // Real underlying CRM control must be clickable, not just visible behind an overlay.
  await page.getByPlaceholder("Search by name, phone, address, job ID...").fill("MM-101");
  await page.getByRole("button", { name: "Restore Marshmallow Copilot" }).click();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toBeFocused();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue("Keep this unsent draft");
  await expect(panel.getByText("MM-101 · Synthetic Customer", { exact: true })).toBeVisible(); expect(fixture.questions).toHaveLength(1);
  await panel.getByRole("button", { name: "Minimize Copilot" }).click();
  // The normal header launcher restores the existing session too.
  await launcher.click(); await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue("Keep this unsent draft");
  await panel.getByRole("button", { name: "Minimize Copilot" }).click();
  await page.getByRole("button", { name: "Close minimized Copilot" }).click();
  await expect(page.getByRole("button", { name: "Restore Marshmallow Copilot" })).toHaveCount(0);
  await launcher.click(); await expect(panel.getByRole("heading", { name: "How may I help you today?" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toBeEmpty();
});

test("Minimized Copilot keeps its session when navigating to another work page", async ({ page }) => {
  await isolatedCopilot(page); await page.goto("/leads"); await page.getByRole("button", { name: "Ask Marshmallow Copilot", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Marshmallow Copilot" });
  await panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" }).fill("Keep my session across pages");
  await panel.getByRole("button", { name: "Minimize Copilot" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click(); await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByRole("button", { name: "Restore Marshmallow Copilot" }).click();
  await expect(panel.getByRole("textbox", { name: "Ask Marshmallow Copilot" })).toHaveValue("Keep my session across pages");
});
