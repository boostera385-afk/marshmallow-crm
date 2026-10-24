import { test, expect, type Page } from "@playwright/test";
import type { AppRole } from "../../src/types";

const USER = "00000000-0000-4000-8000-000000000001";
const OPERATOR = "00000000-0000-4000-8000-000000000002";

// Every external request/websocket is blocked or fulfilled with synthetic data.
async function isolatedSession(page: Page, role: AppRole) {
  const copilotRequests: string[] = [];
  await page.context().routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (/copilot/.test(url.pathname)) {
      copilotRequests.push(url.pathname);
      return route.fulfill({ status: 503, json: { error: "Synthetic paused backend", code: "copilot_paused" } });
    }
    let data: unknown = [];
    const endpoint = url.pathname.split("/").pop();
    if (url.pathname.startsWith("/auth/v1/")) data = { id: USER, email: "synthetic@example.invalid" };
    else if (endpoint === "profiles" || endpoint === "profiles_public") data = [
      { id: USER, full_name: "Synthetic Admin", email: "synthetic@example.invalid" },
      ...(!url.searchParams.has("id") ? [{ id: OPERATOR, full_name: "Synthetic Operator" }] : []),
    ];
    else if (endpoint === "user_roles") data = url.searchParams.get("select") === "user_id,role"
      ? [{ user_id: USER, role }, { user_id: OPERATOR, role: "opr" }] : [{ user_id: USER, role }];
    else if (endpoint === "get_lead_copy_access") data = false;
    else if (endpoint === "get_lead_copy_settings") data = { roles: [], users: [] };
    else if (endpoint === "get_operator_hold_alerts") data = { observed_at: "2026-10-19T00:00:00Z", unread_count: 0, alerts: [] };
    if (route.request().headers().accept?.includes("application/vnd.pgrst.object+json") && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ json: data, headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" } });
  });
  await page.addInitScript(({ id }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-kxiqholnmhkwhdkhtopp-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800,
      expires_in: 3600, token_type: "bearer", user: { id, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated" } }));
    localStorage.setItem("auth_verified_user_id", id);
  }, { id: USER });
  return copilotRequests;
}

for (const role of ["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const) {
  test(`Copilot stays removed for ${role} while normal commands still work`, async ({ page }) => {
    const requests = await isolatedSession(page, role);
    await page.goto("/leads");
    await expect(page.getByRole("button", { name: "Open notepad manager" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask Marshmallow Copilot" })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("Type a command or search...")).toBeVisible();
    await expect(page.getByRole("option", { name: "Ask Marshmallow Copilot" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "All Leads", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: "Open notepad manager" })).toBeVisible();
    expect(requests).toEqual([]);
  });
}

for (const width of [1366, 390]) {
  test(`Feature Access has the original user controls without Copilot at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await isolatedSession(page, "admin");
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Feature & Navigation Access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Marshmallow Copilot", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next features" })).toHaveCount(0);
    await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
    await expect(page.getByRole("switch", { name: "CX Quickchat for Synthetic Operator", exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByLabel("Find feature", { exact: true }).fill("Copilot");
    await expect(page.getByText(/No matching features/)).toBeVisible();
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
