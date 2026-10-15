import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync(new URL("../../public/extension-release.json", import.meta.url), "utf8")).version;
const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
async function isolatedBoard(page: Page, role = "processor", fail = false, options: { setup?: boolean; retryOnce?: boolean } = {}) {
  const actions: Record<string, unknown>[] = [];
  let reviewed = false;
  let failures = 0;
  const row = () => ({ id: LEAD, job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", service_type: "Garage Door Service", address: "10 Sample St Apt 2", city: "Miami", state: "FL", tech_name: "Alex Technician", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only; call before arrival", terms: "Quoted", status: "scheduled", updated_at: "2026-01-01T00:00:00Z", checked_at: reviewed ? new Date().toISOString() : null,
    assessment: reviewed ? { status: "payment_pending", evidence: [{ signal: "completed", quote: "JOB-1001 is completed and ready for payment.", message_id: "m1", message_time: "2026-01-01T18:00:00Z", sender: "customer" }], messages_reviewed: 534, matched_messages: 4, source: "Quo current history", history_complete: true, timezone: "America/New_York", checked_at: new Date().toISOString(), summary: "Job-specific source quotes verified.", lead_updated_at: "2026-01-01T00:00:00Z" } : null,
    ...(options.setup ? { tech_number: null, scheduled_date: null, scheduled_time_start: null } : {}) });
  await page.context().routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (url.pathname.endsWith("/functions/v1/processor-board")) {
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === "list") return route.fulfill({ json: { rows: [row()], total: 1, observed_at: new Date().toISOString(), timezone: body.timezone } });
      if (fail || (options.retryOnce && failures++ === 0)) return route.fulfill({ status: 503, json: { error: "Synthetic AI provider unavailable. Previous review retained.", code: "ai_provider", retryable: true } });
      reviewed = true; return route.fulfill({ json: { result: row().assessment, cached: false } });
    }
    let data: unknown = [];
    const endpoint = url.pathname.split("/").pop();
    if (url.pathname.startsWith("/auth/v1/")) data = { id: USER, email: "synthetic@example.invalid" };
    else if (endpoint === "profiles" || endpoint === "profiles_public") data = [{ id: USER, full_name: "Synthetic User", email: "synthetic@example.invalid" }];
    else if (endpoint === "user_roles") data = [{ user_id: USER, role }];
    else if (endpoint === "get_lead_copy_access") data = false;
    else if (url.pathname.endsWith("/functions/v1/cx-update-requests")) data = { count: 0 };
    else if (url.pathname.endsWith("/functions/v1/marshmallow-copilot")) data = { allowed: false, aiEnabled: false, role, timezone: "UTC", sections: [] };
    else if (endpoint === "get_operator_hold_alerts") data = { observed_at: new Date().toISOString(), unread_count: 0, alerts: [] };
    if (route.request().headers().accept?.includes("application/vnd.pgrst.object+json") && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ json: data, headers: { "content-range": "0-0/0", "access-control-allow-origin": "*" } });
  });
  await page.addInitScript(({ id, version }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-kxiqholnmhkwhdkhtopp-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user: { id, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated" } }));
    localStorage.setItem("auth_verified_user_id", id);
    localStorage.setItem(`donut-release-notice:${id}:${version}`, "shown");
  }, { id: USER, version });
  return actions;
}
for (const width of [1440, 390]) test(`Processor reviews the correct job and evidence at ${width}px without changing lead status`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const actions = await isolatedBoard(page); await page.goto("/processor-board");
  await expect(page.getByRole("heading", { name: "Processor Board", exact: true })).toBeVisible();
  await expect(page.getByText("Alex Technician").filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath(`processor-board-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true }).click();
  await expect(page.getByRole("dialog")).toContainText("John Sample");
  await expect(page.getByRole("dialog")).toContainText("Afternoons only; call before arrival");
  await page.getByRole("button", { name: "Check this job" }).click();
  await expect(page.getByRole("dialog")).toContainText("JOB-1001 is completed and ready for payment.");
  await expect(page.getByRole("dialog")).toContainText("Saved lead status: Scheduled");
  await expect(page.getByRole("dialog")).toContainText("534 conversation events examined");
  expect(actions.filter((a) => a.action === "assess")).toEqual([{ action: "assess", leadId: LEAD, timezone: "America/New_York" }]);
});
test("failed provider review remains explicit and does not advance the job", async ({ page }) => {
  await isolatedBoard(page, "processor", true); await page.goto("/processor-board");
  await page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Check this job" }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic AI provider unavailable");
  await expect(page.getByRole("dialog")).toContainText("Saved lead status: Scheduled");
});
for (const width of [1440, 390]) {
  test(`incomplete jobs show a repair path without an AI request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const actions = await isolatedBoard(page, "processor", false, { setup: true }); await page.goto("/processor-board");
    await page.getByLabel("Filter this page").selectOption("setup");
    await expect(page.getByRole("button", { name: "Refresh AI · this page" })).toBeDisabled();
    await expect(page.getByText(/Save a valid technician number/).filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true }).click();
    await expect(page.getByRole("alert")).toContainText("Saved details need attention");
    await expect(page.getByRole("button", { name: "Check this job" })).toBeDisabled();
    await expect(page.getByRole("link", { name: /Open saved lead/ })).toHaveAttribute("href", `/leads/${LEAD}`);
    expect(actions.filter((action) => action.action === "assess")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
  test(`failed-only retry recovers and fresh page reviews avoid repeat requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const actions = await isolatedBoard(page, "processor", false, { retryOnce: true }); await page.goto("/processor-board");
    await page.getByRole("button", { name: "Refresh AI · this page" }).click();
    await expect(page.getByRole("button", { name: "Retry failed · 1" })).toBeEnabled();
    await expect(page.getByText(/Synthetic AI provider unavailable/).filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry failed · 1" }).click();
    await expect(page.getByRole("status")).toContainText("1 reviewed · 0 failed");
    await expect(page.getByRole("button", { name: /Retry failed/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh AI · this page" }).click();
    await expect(page.getByRole("status")).toContainText("0 reviewed · 0 failed · 1 skipped");
    expect(actions.filter((action) => action.action === "assess")).toHaveLength(2);
    await page.screenshot({ path: test.info().outputPath(`processor-recovery-${width}.png`), fullPage: true });
  });
}
for (const role of ["opr", "opr_admin", "customer_service", "cs_admin"]) test(`${role} cannot access Processor Board`, async ({ page }) => {
  const actions = await isolatedBoard(page, role); await page.goto("/processor-board");
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole("link", { name: "Processor Board" })).toHaveCount(0);
  expect(actions).toEqual([]);
});
