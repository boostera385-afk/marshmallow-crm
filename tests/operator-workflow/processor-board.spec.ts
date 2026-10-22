import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync(new URL("../../public/extension-release.json", import.meta.url), "utf8")).version;
const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
async function isolatedBoard(page: Page, role = "processor", fail = false, options: { setup?: boolean; retryOnce?: boolean; showcase?: boolean; auto?: boolean } = {}) {
  const actions: Record<string, unknown>[] = [];
  let reviewed = false;
  let failures = 0;
  const row = () => ({ id: LEAD, job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", service_type: "Garage Door Service", address: "10 Sample St Apt 2", city: "Miami", state: "FL", tech_name: "Alex Technician", tech_number: "4155550199", scheduled_date: "2026-01-01", scheduled_time_start: "10:00:00", scheduled_time_end: "12:00:00", customer_schedule_requirements: "Afternoons only; call before arrival", terms: "Quoted", status: "scheduled", updated_at: "2026-01-01T00:00:00Z", checked_at: reviewed ? new Date().toISOString() : null,
    assessment: reviewed ? { status: "payment_pending", evidence: [{ signal: "completed", quote: "JOB-1001 is completed and ready for payment.", message_id: "m1", message_time: "2026-01-01T18:00:00Z", sender: "customer" }], messages_reviewed: 534, matched_messages: 4, source: "Quo current history", history_complete: true, ai_used: true, chat_fingerprint: options.auto ? "verified-setup" : undefined, timezone: "America/New_York", checked_at: new Date().toISOString(), summary: "Job-specific source quotes verified.", lead_updated_at: "2026-01-01T00:00:00Z" } : null,
    chat_setup: options.auto ? { state: "ready", code: "ready", message: "Exact saved technician chat verified", fingerprint: "verified-setup", conversation_id: "00000000-0000-4000-8000-000000000010", last_message_at: null, source: "verified_mirror" } : undefined,
    ...(options.setup ? { tech_number: null, scheduled_date: null, scheduled_time_start: null } : {}) });
  const rows = () => {
    const base = row();
    if (!options.showcase) return [base];
    const checkedAt = new Date().toISOString();
    const assessment = (status: string) => ({ status, evidence: [], messages_reviewed: 12, matched_messages: 2, source: "Quo current history", history_complete: true, timezone: "America/New_York", checked_at: checkedAt, summary: "Synthetic job-specific review.", lead_updated_at: base.updated_at });
    return [base,
      { ...base, id: "00000000-0000-4000-8000-000000000003", job_id: "JOB-1002", customer_name: "Jordan Example", service_type: "Pool service", status: "job_in_progress" },
      { ...base, id: "00000000-0000-4000-8000-000000000004", job_id: "JOB-1003", customer_name: "Casey Sample", service_type: "Roof repair", status: "payment_pending" },
      { ...base, id: "00000000-0000-4000-8000-000000000005", job_id: "JOB-1004", customer_name: "Morgan Demo", service_type: "Handyman service", checked_at: checkedAt, assessment: assessment("send_dose") },
      { ...base, id: "00000000-0000-4000-8000-000000000006", job_id: "JOB-1005", customer_name: "Riley Example", service_type: "Carpet cleaning", tech_number: null },
      { ...base, id: "00000000-0000-4000-8000-000000000007", job_id: "JOB-1006", customer_name: "Taylor Sample", service_type: "Sofa cleaning", checked_at: checkedAt, assessment: assessment("unavailable") },
    ];
  };
  await page.context().routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (url.pathname.endsWith("/functions/v1/processor-board")) {
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === "list") { const jobs = rows(); return route.fulfill({ json: { rows: jobs, total: jobs.length, observed_at: new Date().toISOString(), timezone: body.timezone, monitoring: options.auto ? { ai_configured: true, current_history_configured: true } : undefined } }); }
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
  await expect(page.getByText("Not checked yet").filter({ visible: true }).first()).toBeVisible();
  expect(actions.filter((a) => a.action === "assess")).toHaveLength(0);
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
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  const status = width >= 768 ? page.locator("tbody tr").first().locator("td").nth(2) : page.locator("article").filter({ visible: true }).first();
  const checked = status.locator("time");
  await expect(checked).toHaveText("Checked just now");
  await expect(checked).toHaveAttribute("title", /.+/);
  await expect(status.getByLabel("Last checked date and time")).toContainText(new Date().getUTCFullYear().toString());
  await expect(status).toContainText("AI evidence · technician completion verified");
  const checkedBox = await checked.boundingBox();
  const statusBox = await status.getByText("Payment Pending", { exact: true }).boundingBox();
  expect(checkedBox!.y + checkedBox!.height).toBeLessThanOrEqual(statusBox!.y);
  await page.screenshot({ path: test.info().outputPath(`processor-checked-${width}.png`), fullPage: true });
});
test("failed provider review remains explicit and does not advance the job", async ({ page }) => {
  await isolatedBoard(page, "processor", true); await page.goto("/processor-board");
  await page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Check this job" }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic AI provider unavailable");
  await expect(page.getByRole("dialog")).toContainText("Saved lead status: Scheduled");
});
for (const width of [1440, 390]) test(`automatic tracking requires timezone confirmation and preserves saved status at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const actions = await isolatedBoard(page, "processor", false, { auto: true });
  await page.goto("/processor-board");
  await expect(page.getByLabel("Automatic AI tracking")).toBeChecked();
  await expect(page.getByLabel("Confirm schedule timezone")).not.toBeChecked();
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(0);
  await page.getByLabel("Confirm schedule timezone").check();
  await expect(page.getByRole("status")).toContainText("Automatic check: 1 reviewed");
  await expect(page.getByText("AI evidence · technician completion verified").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Saved: Scheduled", { exact: false }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh AI · this page" }).click();
  await expect(page.getByRole("status")).toContainText("0 reviewed · 0 failed · 1 skipped");
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath(`processor-auto-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test("automatic tracking can be paused before starting and setup problems never invoke the provider", async ({ page }) => {
  const actions = await isolatedBoard(page, "processor", false, { auto: true, setup: true });
  await page.goto("/processor-board");
  await page.getByLabel("Automatic AI tracking").uncheck();
  await page.getByLabel("Confirm schedule timezone").check();
  await expect(page.getByText("Paused. Manual checks remain available.")).toBeVisible();
  await page.getByLabel("Automatic AI tracking").check();
  await expect(page.getByText(/Save a valid technician number/).filter({ visible: true })).toBeVisible();
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(0);
});
for (const width of [1440, 390]) test(`saved-status filtering preserves the board and makes no AI calls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const actions = await isolatedBoard(page, "processor", false, { showcase: true });
  await page.goto("/processor-board");
  await page.getByLabel("Saved status on this page").selectOption("job_in_progress");
  const job = page.getByRole("button", { name: "Review JOB-1002" }).filter({ visible: true });
  await expect(job).toBeVisible();
  await expect(page.getByRole("button", { name: "Review JOB-1001" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true })).toBeVisible();
  expect(actions.filter((action) => action.action === "list")).toHaveLength(1);
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
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

for (const theme of ["dark", "light"] as const) {
  test(`colored queue supports keyboard filtering, reduced motion and ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
    const actions = await isolatedBoard(page, "processor", false, { showcase: true });
    await page.goto("/processor-board");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.locator("tbody tr")).toHaveCount(6);
    const accents = await page.locator("tbody tr td:first-child").evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).boxShadow));
    expect(new Set(accents).size).toBe(6);
    const panel = page.getByRole("region", { name: "Scheduled jobs" });
    await expect(panel).toHaveCSS("opacity", "1");
    await expect(panel).toHaveCSS("transform", "none");
    const filter = page.getByRole("button", { name: /Payment Pending/ });
    await filter.hover();
    await expect(filter).toHaveCSS("transform", "none");
    await expect(filter).toHaveCSS("transition-duration", "0s");
    await filter.focus(); await page.keyboard.press("Enter");
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("Casey Sample");
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(6);
    await page.screenshot({ path: test.info().outputPath(`processor-colors-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByText("Casey Sample").filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`processor-colors-mobile-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Review JOB-1001" }).filter({ visible: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS("animation-name", "none");
    await expect(page.getByRole("dialog")).toHaveCSS("transition-duration", "0s");
    await expect(page.getByRole("dialog")).toContainText("Saved lead status: Scheduled");
    expect(actions.filter((action) => action.action === "assess")).toEqual([]);
    expect(actions.filter((action) => action.action === "list")).toHaveLength(1);
  });
}

test("standard motion adds a restrained hover lift without new data or provider requests", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const actions = await isolatedBoard(page);
  await page.goto("/processor-board");
  const filter = page.getByRole("button", { name: /Take Job Update/ });
  await filter.hover();
  await expect(filter).toHaveCSS("transform", /matrix/);
  await page.mouse.move(0, 0);
  await expect(filter).toHaveCSS("transform", "none");
  expect(actions.filter((action) => action.action === "assess")).toEqual([]);
  expect(actions.filter((action) => action.action === "list")).toHaveLength(1);
});

test("five-row viewport scrolls to later jobs with sticky headings and an adjustable visible-row limit", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const actions = await isolatedBoard(page, "processor", false, { showcase: true });
  await page.goto("/processor-board");
  const viewport = page.getByRole("region", { name: "Scrollable jobs" }).filter({ visible: true });
  await expect(page.getByLabel("Rows in view")).toHaveValue("5");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  const bounds = await viewport.boundingBox();
  const fifth = await page.locator("tbody tr").nth(4).boundingBox();
  const sixth = await page.locator("tbody tr").nth(5).boundingBox();
  expect(fifth!.y + fifth!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
  expect(sixth!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1);
  await viewport.focus(); await page.keyboard.press("End");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const header = await page.locator("thead").boundingBox();
  const scrolledBounds = await viewport.boundingBox();
  expect(Math.abs(header!.y - scrolledBounds!.y)).toBeLessThan(3);
  await page.getByRole("button", { name: "Review JOB-1006" }).filter({ visible: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Taylor Sample");
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await page.getByLabel("Rows in view").selectOption("10");
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await viewport.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(2);
  await page.getByLabel("Rows in view").selectOption("5");
  await page.getByLabel("Filter this page").selectOption("setup");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Riley Example");
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await page.screenshot({ path: test.info().outputPath("processor-five-rows.png"), fullPage: true });
  expect(actions.filter((action) => action.action === "list")).toHaveLength(1);
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(0);
});

test("mobile jobs remain reachable inside a bounded keyboard-accessible scroll region", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const actions = await isolatedBoard(page, "processor", false, { showcase: true });
  await page.goto("/processor-board");
  const viewport = page.getByRole("region", { name: "Scrollable jobs" }).filter({ visible: true });
  await expect(viewport).toHaveAttribute("tabindex", "0");
  expect(await viewport.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(630);
  await viewport.focus(); await page.keyboard.press("End");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Review JOB-1006" }).filter({ visible: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Taylor Sample");
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await page.getByLabel("Rows in view").selectOption("25");
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("processor-scroll-mobile.png"), fullPage: true });
  expect(actions.filter((action) => action.action === "list")).toHaveLength(1);
  expect(actions.filter((action) => action.action === "assess")).toHaveLength(0);
});
