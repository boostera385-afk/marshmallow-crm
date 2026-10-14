import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync(new URL("../../public/extension-release.json", import.meta.url), "utf8")).version;
const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
const REQUEST = "00000000-0000-4000-8000-000000000003";
async function isolatedCx(page: Page, role: string, options: { updated?: boolean; failure?: boolean } = {}) {
  const actions: Record<string, unknown>[] = [];
  let pending = !options.updated;
  let acknowledged = false;
  const customer = { job_id: "CX-HIDDEN", customer_name: "Synthetic Hidden Customer", customer_phone: "5550100000", customer_landline: null, customer_email: null,
    service_type: "Plumbing", service_details: "Synthetic repair", address: "10 Test St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
    customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00", scheduled_time_end: null };
  const row = () => ({ id: REQUEST, lead_id: LEAD, requested_by: USER, requester_name: "Synthetic Processor", recipient_cs: USER, recipient_name: "Synthetic CS",
    request_text: "Confirm Friday availability", status: pending ? "pending" : "cs_updated", response_text: pending ? null : "Friday confirmed", completed_at: pending ? null : "2026-10-13T06:00:00Z",
    completed_by_name: pending ? null : "Synthetic CS", created_at: "2026-10-13T05:00:00Z", customer });
  await page.context().routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (url.pathname.endsWith("/functions/v1/cx-update-requests")) {
      const body = route.request().postDataJSON(); actions.push(body);
      if (role === "opr" || role === "opr_admin") return route.fulfill({ status: 403, json: { error: "Access denied" } });
      if (body.action === "count") return route.fulfill({ json: { count: acknowledged || ((role === "customer_service" || role === "cs_admin") && !pending) ? 0 : 1 } });
      if (body.action === "list_pending" || body.action === "list_updated") {
        const rows = !acknowledged && (body.action === "list_pending" ? pending : !pending) ? [row()] : [];
        return route.fulfill({ json: { rows, total: rows.length } });
      }
      if (options.failure) return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
      if (body.action === "complete") pending = false;
      if (body.action === "acknowledge") acknowledged = true;
      return route.fulfill({ json: { saved: true, id: body.requestId } });
    }
    let data: unknown = [];
    const endpoint = url.pathname.split("/").pop();
    if (url.pathname.startsWith("/auth/v1/")) data = { id: USER, email: "synthetic@example.invalid" };
    else if (endpoint === "profiles" || endpoint === "profiles_public") data = [{ id: USER, full_name: "Synthetic User", email: "synthetic@example.invalid" }];
    else if (endpoint === "user_roles") data = [{ user_id: USER, role }];
    else if (endpoint === "leads" && (role === "admin" || role === "processor")) data = [{ id: LEAD, ...customer, status: "paid", created_by: USER,
      created_at: "2026-10-13T05:00:00Z", tech_name: "TECH-SECRET", tech_number: "5550109999" }];
    else if (endpoint === "get_lead_status_counts") data = [];
    else if (endpoint === "get_lead_copy_access") data = false;
    else if (endpoint === "get_operator_hold_alerts") data = { observed_at: "2026-10-13T05:00:00Z", unread_count: 0, alerts: [] };
    else if (url.pathname.endsWith("/functions/v1/marshmallow-copilot")) data = { allowed: false, aiEnabled: false, role, timezone: "UTC", sections: [] };
    if (route.request().headers().accept?.includes("application/vnd.pgrst.object+json") && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ json: data, headers: { "content-range": "0-0/1", "access-control-allow-origin": "*" } });
  });
  await page.addInitScript(({ id, version }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-kxiqholnmhkwhdkhtopp-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800,
      expires_in: 3600, token_type: "bearer", user: { id, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated" } }));
    localStorage.setItem("auth_verified_user_id", id);
    localStorage.setItem(`donut-release-notice:${id}:${version}`, "shown");
  }, { id: USER, version });
  return actions;
}

for (const role of ["customer_service", "cs_admin"]) for (const width of [1366, 390]) test(`${role} sees hidden customer-only request and completes it at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const actions = await isolatedCx(page, role); await page.goto("/get-cx-update");
  await expect(page.getByRole("heading", { name: "Synthetic Hidden Customer" })).toBeVisible();
  await expect(page.getByText("10 Test St Apt 2, Miami, FL, 33101")).toBeVisible();
  await expect(page.getByText("TECH-SECRET")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open lead", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole("button", { name: "Mark CS Updated" }).click();
  await expect(page.getByRole("button", { name: "Save CS Updated" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Customer update" }).fill("Friday confirmed");
  if (width === 1366 && role === "customer_service") await page.screenshot({ path: test.info().outputPath("cx-update-completion.png") });
  await page.getByRole("button", { name: "Save CS Updated" }).click();
  await expect(page.getByRole("dialog", { name: "Mark CS Updated" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Synthetic Hidden Customer" })).toHaveCount(0);
  expect(actions.filter((action) => action.action === "complete")).toEqual([{ kind: "cx", action: "complete", requestId: REQUEST, text: "Friday confirmed" }]);
});
test("CS failure retains pending request and typed response without false success", async ({ page }) => {
  await isolatedCx(page, "customer_service", { failure: true }); await page.goto("/get-cx-update");
  await page.getByRole("button", { name: "Mark CS Updated" }).click();
  await page.getByRole("textbox", { name: "Customer update" }).fill("Friday confirmed");
  await page.getByRole("button", { name: "Save CS Updated" }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic save unavailable");
  await expect(page.getByRole("textbox", { name: "Customer update" })).toHaveValue("Friday confirmed");
  // Radix makes background content aria-hidden while the response dialog is
  // open. Close the dialog before checking that the pending card remains.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Hidden Customer" })).toBeVisible();
  await expect(page.getByText("CS Updated — returned to Processor/Admin")).toHaveCount(0);
});
test("Processor reviews and acknowledges returned update without changing the job", async ({ page }) => {
  const actions = await isolatedCx(page, "processor", { updated: true }); await page.goto("/get-cx-update?tab=updated");
  await expect(page.getByText("Friday confirmed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open lead" })).toHaveAttribute("href", `/leads/${LEAD}`);
  await expect(page.getByRole("button", { name: "Mark CS Updated" })).toHaveCount(0);
  await page.getByRole("button", { name: "Acknowledge update" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Hidden Customer" })).toHaveCount(0);
  expect(actions.some((action) => action.action === "acknowledge")).toBe(true);
});
test("Processor can request customer follow-up from a saved paid lead card", async ({ page }) => {
  const actions = await isolatedCx(page, "processor"); await page.goto("/leads");
  await page.getByRole("button", { name: "Get CX Update", exact: true }).click();
  await page.getByRole("textbox", { name: "Required customer update" }).fill("Confirm Friday availability");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("dialog", { name: "Get CX Update" })).toHaveCount(0);
  expect(actions.filter((action) => action.action === "create")).toEqual([{ kind: "cx", action: "create", leadId: LEAD, requestId: expect.any(String), text: "Confirm Friday availability" }]);
});
for (const role of ["opr", "opr_admin"]) test(`${role} cannot access queue route or sidebar`, async ({ page }) => {
  const actions = await isolatedCx(page, role); await page.goto("/get-cx-update");
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole("link", { name: "Get CX Update" })).toHaveCount(0);
  expect(actions).toHaveLength(0);
});
