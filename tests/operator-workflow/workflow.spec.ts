import { test, expect, type Page } from "@playwright/test";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const JOB_ID = "00000000-0000-4000-8000-000000000002";
const ALERT_ID = "00000000-0000-4000-8000-000000000003";
const REVISION_ID = "00000000-0000-4000-8000-000000000004";
const longService = "Very long specialist plumbing and water heater repair service";
const savedLead = {
  id: JOB_ID, job_id: "MM-123", status: "urgent_job", customer_name: "Synthetic Customer",
  customer_phone: "5550100000", customer_landline: null, customer_email: "", service_type: "Plumbing",
  service_details: "Fix the sink", address: "10 Main St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
  customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00",
  scheduled_time_end: "15:00:00", created_by: USER_ID, created_at: "2026-10-12T05:00:00Z", updated_at: "2026-10-12T05:00:00Z",
  tech_name: "Synthetic Tech", tech_number: "5550100001", cs_tag: null, quote: "PRIVATE QUOTE", show_quote_to_opr: false,
  latitude: 25.76, longitude: -80.19, coverage_level: "good", coverage_tech_count: 12,
};
const snapshot = { ...savedLead, status: "scheduled", quote: null };

async function mockSession(page: Page, role: "admin" | "opr" | "opr_admin", options: { copyAllowed?: boolean; hold?: boolean; photos?: boolean } = {}) {
  let holdRead = false;
  let permission = options.copyAllowed ?? true;
  const roleDefaults = ["processor", "customer_service", "cs_admin", "opr", "opr_admin"].map((item) => ({ role: item, allowed: true }));
  const userOverrides: { user_id: string; allowed: boolean }[] = [];
  await page.context().routeWebSocket(/supabase\.co/, (socket) => { socket.close(); });
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    // No request can reach the shared DB, Edge Functions, storage, tile servers, or Quo.
    if (!url.hostname.endsWith("supabase.co")) return route.abort();
    if (url.pathname.startsWith("/storage/v1/object/sign/lead-photos")) {
      if (route.request().method() === "GET") return route.fulfill({
        contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="grey"/></svg>',
      });
      const paths: string[] = route.request().postDataJSON()?.paths ?? [];
      const signedURL = (path: string) => `/object/sign/lead-photos/${path}?token=synthetic`;
      return route.fulfill({ json: paths.length
        ? paths.map((path) => ({ path, signedURL: signedURL(path), error: null }))
        : { signedURL: signedURL(url.pathname.split("/lead-photos/")[1]) } });
    }
    const endpoint = url.pathname.split("/").pop();
    let data: unknown = [];
    if (url.pathname.startsWith("/auth/v1/")) data = { id: USER_ID, email: "synthetic@example.invalid" };
    else if (url.pathname.includes("/rpc/")) {
      if (endpoint === "get_lead_copy_access") data = permission;
      else if (endpoint === "get_lead_copy_settings") data = { roles: roleDefaults, users: userOverrides };
      else if (endpoint === "set_lead_copy_permission") {
        const args = route.request().postDataJSON();
        if (args.p_role) roleDefaults.find((item) => item.role === args.p_role)!.allowed = args.p_allowed;
        else {
          const index = userOverrides.findIndex((item) => item.user_id === args.p_user_id);
          if (index >= 0) userOverrides.splice(index, 1);
          if (args.p_allowed !== null) userOverrides.push({ user_id: args.p_user_id, allowed: args.p_allowed });
        }
        permission = args.p_allowed !== false;
        data = null;
      } else if (endpoint === "get_operator_hold_alerts") data = {
        observed_at: "2026-10-12T05:01:00Z", unread_count: options.hold && !holdRead ? 1 : 0,
        alerts: options.hold ? [{ id: ALERT_ID, lead_id: JOB_ID, revision: REVISION_ID, reason: "scheduled", snapshot, read: holdRead, created_at: "2026-10-12T05:00:00Z" }] : [],
      };
      else if (endpoint === "acknowledge_operator_hold_alert") { holdRead = true; data = 1; }
      else if (endpoint === "get_lead_status_counts") data = [{ status: "urgent_job", count: 1 }];
    } else if (endpoint === "profiles" || endpoint === "profiles_public") data = [
      { id: USER_ID, full_name: "Synthetic User", email: "synthetic@example.invalid", is_quotation_master: false, can_manage_users: false },
    ];
    else if (endpoint === "user_roles") data = [{ user_id: USER_ID, role }];
    else if (endpoint === "leads") data = [savedLead];
    else if (endpoint === "lead_photos" && options.photos) data = [
      { id: ALERT_ID, lead_id: JOB_ID, photo_url: "synthetic-one.svg" },
      { id: REVISION_ID, lead_id: JOB_ID, photo_url: "synthetic-two.svg" },
    ];
    else if (endpoint === "technicians") data = [{ id: JOB_ID, name: "Synthetic Tech", service: longService, area: "Miami, FL", phone_number: "5550100001", is_active: true, latitude: 25.76, longitude: -80.19 }];
    else if (endpoint === "quo_ai_settings") data = [];
    const singular = route.request().headers().accept?.includes("application/vnd.pgrst.object+json");
    if (singular && Array.isArray(data)) data = data[0] ?? null;
    await route.fulfill({ status: 200, json: data, headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" } });
  });
  await page.addInitScript(({ id }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-kxiqholnmhkwhdkhtopp-auth-token", JSON.stringify({
      access_token: accessToken, refresh_token: "synthetic", expires_at: 4102444800, expires_in: 3600,
      token_type: "bearer", user: { id, email: "synthetic@example.invalid", aud: "authenticated", role: "authenticated" },
    }));
    localStorage.setItem("auth_verified_user_id", id);
  }, { id: USER_ID });
}

for (const role of ["opr", "opr_admin"] as const) {
  test(`${role}: saved-photo View action opens, navigates and closes without sending`, async ({ page }) => {
    await page.setViewportSize({ width: role === "opr" ? 1440 : 390, height: 900 });
    await mockSession(page, role, { photos: true });
    await page.goto("/leads");
    const view = page.getByRole("button", { name: "View 2 photos", exact: true }).first();
    await expect(view).toBeEnabled();
    await view.click();
    const dialog = page.getByRole("dialog", { name: "Photo preview" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByAltText("Image 1")).toBeVisible();
    await expect(dialog.getByAltText("Image 1")).toHaveAttribute("src", /synthetic-one/);
    await dialog.getByRole("button", { name: "Next image" }).click();
    await expect(dialog.getByAltText("Image 2")).toBeVisible();
    await expect(dialog.getByAltText("Image 2")).toHaveAttribute("src", /synthetic-two/);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(view).toBeFocused();
    await expect(page.getByRole("button", { name: "Copy all 2 photos" }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send photos to tech" })).toHaveCount(0);
  });

  test(`${role}: Copy Complete Details visible by default and respects hidden quote`, async ({ page, context }) => {
    await mockSession(page, role);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/leads");
    const copy = page.getByRole("button", { name: "Copy Complete Details" }).first();
    await expect(copy).toBeEnabled();
    await expect(page.getByRole("button", { name: "Edit Lead", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete lead", exact: true })).toHaveCount(0);
    await expect(page.getByTitle("Assign to Operator", { exact: true })).toHaveCount(0);
    await copy.click();
    await expect(page.getByRole("button", { name: "Copied", exact: true }).first()).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("Address: 10 Main St Apt 2");
    expect(text).toContain("Schedule Requirement: Friday afternoon");
    expect(text).not.toContain("PRIVATE QUOTE");
  });

  test(`${role}: Admin denial hides the copy action`, async ({ page }) => {
    await mockSession(page, role, { copyAllowed: false });
    await page.goto("/leads");
    await expect(page.getByText("Synthetic Customer").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy Complete Details" })).toHaveCount(0);
  });

  test(`${role}: grey complete hold card, acknowledgement and bell history`, async ({ page }) => {
    await mockSession(page, role, { hold: true });
    await page.goto("/leads");
    const popup = page.getByRole("complementary", { name: "Operator job hold notification" });
    await expect(popup).toBeVisible();
    await popup.getByRole("button", { name: "Complete card" }).click();
    await expect(popup.getByText("10 Main St Apt 2")).toBeVisible();
    await expect(popup.getByText("Friday afternoon")).toBeVisible();
    await expect(popup.getByText("PRIVATE QUOTE")).toHaveCount(0);
    await popup.getByRole("button", { name: "Acknowledge", exact: true }).click();
    await expect(popup).not.toBeVisible();
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    await page.getByRole("button", { name: /Hold This Job/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Acknowledged");
    await expect(page.getByRole("dialog")).toContainText("10 Main St Apt 2");
  });
}

test("Admin can change role default and apply user override", async ({ page }) => {
  await mockSession(page, "admin");
  // Include a non-admin target in the Settings users query without changing the caller's role query.
  await page.route("**/rest/v1/user_roles?select=user_id%2Crole", (route) => route.fulfill({ json: [
    { user_id: USER_ID, role: "admin" }, { user_id: JOB_ID, role: "opr" },
  ] }));
  await page.route("**/rest/v1/profiles?select=id%2Cemail%2Cfull_name%2C*", (route) => route.fulfill({ json: [
    { id: USER_ID, full_name: "Synthetic Admin", email: "admin@example.invalid" },
    { id: JOB_ID, full_name: "Synthetic Operator", email: "operator@example.invalid" },
  ] }));
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  const roleSwitch = page.getByRole("switch", { name: "Allow Copy Complete Details for Operator", exact: true });
  await expect(roleSwitch).toBeChecked();
  await roleSwitch.click();
  await expect(roleSwitch).not.toBeChecked();
  const override = page.getByRole("combobox", { name: "Copy override for Synthetic Operator" });
  await override.click();
  await page.getByRole("option", { name: "Allow", exact: true }).click();
  await expect(override).toContainText("Allow");
  await expect(page.getByText("Operator · Effective access: Allowed", { exact: true })).toBeVisible();
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`Map service/state controls do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSession(page, "admin");
    await page.goto("/map-view");
    await page.getByRole("switch", { name: "Map View", exact: true }).click();
    const service = page.getByRole("combobox", { name: "Filter map by service" });
    const state = page.getByRole("combobox", { name: "Filter map by state" });
    await service.click();
    await page.getByRole("option", { name: longService, exact: true }).click();
    const [a, b] = await Promise.all([service.boundingBox(), state.boundingBox()]);
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
    expect(b!.x + b!.width).toBeLessThanOrEqual(width);
    await state.click();
    await expect(page.getByRole("listbox")).toHaveCount(1);
    const option = page.getByRole("option", { name: "FL · Florida" });
    await expect(option).toBeVisible();
    await option.click();
    await expect(state).toContainText("FL · Florida");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await service.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(service).toBeFocused();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(horizontalOverflow).toBe(false);
  });
}
