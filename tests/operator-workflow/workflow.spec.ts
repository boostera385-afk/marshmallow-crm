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
  location_label: "Miami, FL 33101",
};
const snapshot = { ...savedLead, status: "scheduled", quote: null };

test("Request optimization: notification burst keeps urgent popup and exact unread count", async ({ page }) => {
  await mockSession(page, "admin");
  await page.clock.install();
  let ready = false;
  let reads = 0;
  await page.route("**/rest/v1/notifications*", async (route) => {
    if (route.request().method() === "GET" || route.request().method() === "HEAD") reads++;
    const url = new URL(route.request().url());
    const urgent = url.searchParams.get("title")?.includes("Urgent Job");
    const list = !url.searchParams.has("title");
    await route.fulfill({ status: 200, json: ready && (urgent || list) ? [{
      id: ALERT_ID, user_id: USER_ID, title: "Synthetic Urgent Job", message: "Synthetic urgent notification",
      lead_id: JOB_ID, read: false, created_at: "2026-10-14T00:00:00Z",
    }] : [], headers: {
      "content-range": `0-0/${ready ? 125 : 0}`,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range",
    } });
  });
  await page.goto("/leads");
  await expect(page.getByText("Synthetic Customer").first()).toBeVisible();
  // Bell initially loads before role resolution, then reloads with the resolved role.
  await expect.poll(() => reads).toBe(6);
  const before = reads;
  ready = true;
  await page.evaluate(async ({ userId }) => {
    const modulePath = "/src/lib/realtime.ts";
    const { realtimeBus } = await import(modulePath);
    for (let i = 0; i < 50; i++) {
      realtimeBus.dispatchEvent(new CustomEvent(`notifications:${userId}`, {
        detail: { eventType: "INSERT", new: { user_id: userId, title: "Synthetic Urgent Job" } },
      }));
    }
  }, { userId: USER_ID });
  await expect(page.getByText("Synthetic urgent notification", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toContainText("125");
  expect(reads - before).toBe(3); // Bell list/count and urgent query, not 150 requests.
});

test("Request optimization: notifications recover from a failed read without losing alerts", async ({ page }) => {
  await mockSession(page, "admin");
  await page.clock.install();
  let failed = false;
  let read = false;
  await page.route("**/rest/v1/notifications*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get("title")?.includes("Urgent Job")) return route.fulfill({ json: [] });
    if (failed) return route.fulfill({ status: 403, json: { code: "42501", message: "Synthetic denial" } });
    await route.fulfill({ json: read ? [] : [{
      id: ALERT_ID, user_id: USER_ID, title: "Synthetic Urgent Job", message: "Synthetic alert remains visible",
      lead_id: JOB_ID, read: false, created_at: "2026-10-14T00:00:00Z",
    }] });
  });
  await page.goto("/leads");
  const alert = page.getByText("Synthetic alert remains visible", { exact: true });
  await expect(alert).toBeVisible();
  failed = true;
  await page.clock.runFor(20_100);
  await expect(alert).toBeVisible();
  failed = false;
  read = true;
  await page.clock.runFor(20_100);
  await expect(alert).not.toBeVisible();
});

test("Request optimization: hidden Operator badges make no reads or polls", async ({ page }) => {
  await mockSession(page, "opr");
  await page.clock.install();
  const badgeReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "HEAD") return;
    if (["/rest/v1/lead_cancellation_requests", "/rest/v1/lead_payment_requests"].includes(url.pathname)
      || (url.pathname === "/rest/v1/leads" && url.searchParams.get("status") === "eq.pending_to_send")) {
      badgeReads.push(url.pathname);
    }
  });
  await page.goto("/leads");
  await expect(page.getByText("Synthetic Customer").first()).toBeVisible();
  await page.clock.runFor(60_000);
  expect(badgeReads).toEqual([]);
  await expect(page.getByRole("link", { name: /Cancellation requests/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Payment approvals/ })).toHaveCount(0);
});

test("Request optimization: Admin cancellation badges retain 15-second polling", async ({ page }) => {
  await mockSession(page, "admin");
  await page.clock.install();
  let cancellationReads = 0;
  page.on("request", (request) => {
    if (request.method() === "HEAD" && new URL(request.url()).pathname === "/rest/v1/lead_cancellation_requests") cancellationReads++;
  });
  await page.goto("/leads");
  await expect(page.getByRole("link", { name: /Cancellation requests/ })).toBeVisible();
  await expect.poll(() => cancellationReads).toBeGreaterThan(0);
  const before = cancellationReads;
  await page.clock.runFor(15_100);
  await expect.poll(() => cancellationReads).toBeGreaterThan(before);
});

test("Request optimization: notes catch up when a hidden tab returns", async ({ page }) => {
  await mockSession(page, "admin");
  await page.clock.install();
  let reads = 0;
  let content = "Initial browser synthetic note";
  await page.route("**/rest/v1/lead_notes*", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ json: [] });
    reads++;
    const type = new URL(route.request().url()).searchParams.get("note_type")?.replace("eq.", "") ?? "cs";
    await route.fulfill({ json: [{
      id: ALERT_ID, lead_id: JOB_ID, user_id: null, user_name: "Synthetic",
      note_type: type, content, created_at: "2026-10-14T00:00:00Z",
    }] });
  });
  await page.goto(`/leads/${JOB_ID}`);
  await expect(page.getByText(content).first()).toBeVisible();
  await page.clock.runFor(1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = reads;
  content = "Updated browser synthetic note";
  await page.clock.runFor(60_000);
  expect(reads).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText(content).first()).toBeVisible();
  expect(reads).toBeGreaterThan(before);
});

test.describe("Lead metadata batching", () => {
  for (const role of ["admin", "opr"] as const) {
    test(`${role}: delayed metadata mounts complete cards without per-card reads`, async ({ page }) => {
      await mockSession(page, role, { photos: true });
      let release = () => {};
      const metadataReady = new Promise<void>((resolve) => { release = resolve; });
      let batches = 0;
      const fallbackReads: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (["GET", "HEAD"].includes(request.method()) &&
          ["/rest/v1/lead_notes", "/rest/v1/lead_photos", "/rest/v1/lead_cancellation_requests"].includes(url.pathname) &&
          url.searchParams.get("lead_id")?.startsWith("eq.")) fallbackReads.push(url.pathname);
      });
      await page.route("**/rest/v1/lead_photos*", async (route) => {
        if (new URL(route.request().url()).searchParams.get("lead_id")?.startsWith("in.")) {
          batches++;
          await metadataReady;
        }
        await route.fallback();
      });
      const hydrated = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/rest/v1/leads" && Boolean(url.searchParams.get("id")?.startsWith("in."));
      });
      try {
        await page.goto("/leads", { waitUntil: "domcontentloaded" });
        await hydrated;
        await expect.poll(() => batches).toBeGreaterThan(0);
        // Let React commit the hydrated rows while the independent metadata read
        // stays pending. All external HTTP and WebSocket traffic is mocked above.
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(fallbackReads).toEqual([]);
        await expect(page.locator(".crm-lead-card").filter({ hasText: "Synthetic Customer" })).toHaveCount(0);
        release();
        const card = page.locator(".crm-lead-card").filter({ hasText: "Synthetic Customer" });
        await expect(card).toBeVisible();
        const view = card.getByRole("button", { name: "View 2 photos", exact: true });
        await expect(view).toBeEnabled();
        expect(fallbackReads).toEqual([]);
        await view.click();
        await expect(page.getByRole("dialog", { name: "Photo preview" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(view).toBeFocused();
        if (role === "opr") await expect(card.getByRole("button", { name: "Send photos to tech" })).toHaveCount(0);
      } finally {
        release();
      }
    });
  }

  test("a failed batch still renders cards through the existing individual fallback", async ({ page }) => {
    await mockSession(page, "admin");
    const fallbackReads: string[] = [];
    const failedBatchRetries: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["GET", "HEAD"].includes(request.method()) &&
        ["/rest/v1/lead_notes", "/rest/v1/lead_photos", "/rest/v1/lead_cancellation_requests"].includes(url.pathname) &&
        url.searchParams.get("lead_id")?.startsWith("eq.")) fallbackReads.push(url.pathname);
    });
    await page.route("**/rest/v1/lead_notes*", async (route) => {
      const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Expose-Headers": "Retry-After" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders });
      if (new URL(route.request().url()).searchParams.get("lead_id")?.startsWith("in.")) {
        failedBatchRetries.push(route.request().headers()["x-retry-count"] ?? "0");
        // The installed PostgREST client retries 503 reads three times. Honour
        // that real retry path without spending seven seconds on its backoff.
        return route.fulfill({ status: 503, headers: { ...corsHeaders, "Retry-After": "0" }, json: { code: "PGRST003", message: "Synthetic batch unavailable" } });
      }
      await route.fallback();
    });
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".crm-lead-card").filter({ hasText: "Synthetic Customer" })).toBeVisible();
    await expect.poll(() => [...fallbackReads].sort()).toEqual([
      "/rest/v1/lead_cancellation_requests", "/rest/v1/lead_notes",
      "/rest/v1/lead_photos", "/rest/v1/lead_photos", // Exact count and ordered paths.
    ]);
    expect(failedBatchRetries).toContain("3");
  });
});

async function mockSession(page: Page, role: "admin" | "processor" | "customer_service" | "opr" | "opr_admin", options: { copyAllowed?: boolean; hold?: boolean; photos?: boolean } = {}) {
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
        alerts: options.hold ? [{ id: ALERT_ID, lead_id: JOB_ID, revision: REVISION_ID, reason: "waiting_schedule_confirmation", snapshot: { ...snapshot, cs_tag: "waiting_schedule_confirmation" }, read: holdRead, created_at: "2026-10-12T05:00:00Z" }] : [],
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

test("Operator Todo: CS sees split customer quote but not internal technician shares", async ({ page }) => {
  await mockSession(page, "customer_service");
  const quoted = { ...savedLead, terms: "quoted", labor_amount: 200, material_amount: 60, for_you_amount: 777, for_us_amount: 888 };
  await page.route("**/rest/v1/leads*", (route) => route.fulfill({ json: route.request().headers().accept?.includes("application/vnd.pgrst.object+json") ? quoted : [quoted] }));
  await page.goto(`/leads/${JOB_ID}`);
  const quote = page.getByRole("region", { name: "Quote breakdown" });
  await expect(quote.getByText("Labor Section", { exact: true })).toBeVisible();
  await expect(quote.getByText("$200.00", { exact: true })).toBeVisible();
  await expect(quote.getByText("$60.00", { exact: true })).toBeVisible();
  await expect(quote.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByText("Internal Technician Share", { exact: true })).toHaveCount(0);
  await page.goto("/leads");
  await expect(page.getByText("Quoted · Labor $200.00 · Parts/Materials $60.00", { exact: true })).toBeVisible();
});

test("Operator Todo: Admin Materials No saves null and keeps labor unchanged", async ({ page }) => {
  await mockSession(page, "admin");
  let quoted: Record<string, unknown> = { ...savedLead, number_name: "Synthetic Line", terms: "quoted", labor_amount: 200, material_amount: 60 };
  const writes: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/leads*", async (route) => {
    if (route.request().method() === "PATCH") { writes.push(route.request().postDataJSON()); quoted = { ...quoted, ...writes.at(-1) }; }
    await route.fulfill({ json: route.request().headers().accept?.includes("application/vnd.pgrst.object+json") ? quoted : [quoted] });
  });
  await page.goto(`/leads/${JOB_ID}`);
  const quote = page.getByRole("region", { name: "Quote breakdown" });
  await quote.getByRole("combobox", { name: "Parts/Materials charges?" }).click();
  await page.getByRole("option", { name: "No", exact: true }).click();
  await expect(quote.getByRole("spinbutton", { name: "Parts/Materials ($)", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save Lead", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ labor_amount: 200, material_amount: null });
});

for (const role of ["opr", "opr_admin"] as const) {
  test(`Operator Todo: ${role} has no Donut button; regular OPR sees only safe quote and no CS notes`, async ({ page }) => {
    await mockSession(page, role);
    const quoted = { ...savedLead, terms: "quoted", labor_amount: 200, material_amount: 60, show_quote_to_opr: true };
    await page.route("**/rest/v1/leads*", (route) => route.fulfill({ json: route.request().headers().accept?.includes("application/vnd.pgrst.object+json") ? quoted : [quoted] }));
    await page.goto("/leads");
    await expect(page.getByText("MM-123", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Donut extension version and update instructions" })).toHaveCount(0);
    if (role === "opr") {
      await expect(page.getByText("Quoted · Labor $100.00 · Materials $60.00", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "CS", exact: true })).toHaveCount(0);
      await expect(page.getByText("Synthetic Customer", { exact: true })).toHaveCount(0);
      await expect(page.getByText("PRIVATE QUOTE", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("Synthetic Customer", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "CS", exact: true }).first()).toBeVisible();
    }
  });

  test(`Operator Todo: ${role} acknowledges one hold then all remaining holds in one batch`, async ({ page }) => {
    await mockSession(page, role);
    const holds = Array.from({ length: 4 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, lead_id: JOB_ID,
      revision: REVISION_ID, reason: "scheduled", snapshot: { ...snapshot, job_id: `MM-HOLD-${index}` },
      read: false, created_at: "2026-11-13T07:00:00Z",
    }));
    const actions: Record<string, unknown>[] = [];
    await page.route("**/rest/v1/rpc/get_operator_hold_alerts", (route) => route.fulfill({ json: { observed_at: "2026-11-13T07:01:00Z", unread_count: holds.filter((item) => !item.read).length, alerts: holds } }));
    await page.route("**/rest/v1/rpc/acknowledge_operator_hold_alert", async (route) => {
      const args = route.request().postDataJSON(); actions.push(args);
      const pairs = args.p_alerts || [{ id: args.p_id, revision: args.p_revision }];
      let count = 0;
      for (const hold of holds) if (!hold.read && pairs.some((pair: { id: string; revision: string }) => pair.id === hold.id && pair.revision === hold.revision)) { hold.read = true; count++; }
      await route.fulfill({ json: count });
    });
    await page.goto("/leads");
    const popup = page.getByRole("complementary", { name: "Operator job hold notifications" });
    await expect(popup.getByRole("article")).toHaveCount(3);
    await popup.getByRole("button", { name: "Acknowledge", exact: true }).first().click();
    await expect.poll(() => holds.filter((item) => item.read).length).toBe(1);
    if (role === "opr_admin") {
      await expect(popup.getByRole("button", { name: "Acknowledge All", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    } else {
      await popup.getByRole("button", { name: "Acknowledge All", exact: true }).click();
    }
    await expect(popup).not.toBeVisible();
    expect(holds.every((item) => item.read)).toBe(true);
    expect(actions).toHaveLength(2);
    expect(actions[0].p_alerts).toBeNull();
    expect(actions[1].p_alerts).toHaveLength(3);
  });
}

for (const surface of ["card", "detail"] as const) {
  for (const denied of [false, true]) {
    test(`Partial payment: Processor ${surface} ${denied ? "reports a denied request" : "requests Admin approval without setting Partial Paid"}`, async ({ page }) => {
      await mockSession(page, "processor");
      const requests: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      await page.route("**/rest/v1/lead_payment_requests*", async (route) => {
        if (route.request().method() !== "POST") return route.fulfill({ json: null });
        requests.push(route.request().postDataJSON());
        if (denied) return route.fulfill({ status: 403, json: { message: "Synthetic payment denial", code: "42501" } });
        await route.fulfill({ json: { id: ALERT_ID, ...requests[0] } });
      });
      await page.route("**/rest/v1/leads*", async (route) => {
        if (route.request().method() === "PATCH") updates.push(route.request().postDataJSON());
        const lead = { ...savedLead, ...(updates.at(-1) ?? {}) };
        await route.fulfill({ json: route.request().headers().accept?.includes("application/vnd.pgrst.object+json") ? lead : [lead] });
      });
      await page.goto(surface === "card" ? "/leads" : `/leads/${JOB_ID}`);
      await page.getByRole("combobox").filter({ hasText: /^Urgent Job$/ }).first().click();
      await page.getByRole("option", { name: "Partial Paid", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Request Partial Paid Approval" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("spinbutton").fill("25.50");
      await dialog.getByRole("textbox").fill("Deposit received");
      await dialog.getByRole("button", { name: "Send request" }).click();
      if (denied) {
        await expect(page.getByText("Synthetic payment denial", { exact: true }).first()).toBeVisible();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("spinbutton")).toHaveValue("25.50");
        await expect(dialog.getByRole("textbox")).toHaveValue("Deposit received");
        expect(updates).toEqual([]);
      } else {
        await expect(dialog).not.toBeVisible();
        expect(updates).toHaveLength(1);
        expect(updates[0].status).toBe("payment_requested");
      }
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ request_type: "partial_paid", amount: 25.5, comment: "Deposit received", requested_by_role: "processor" });
    });
  }

  test(`Partial payment: Customer Service cannot select it on ${surface}`, async ({ page }) => {
    await mockSession(page, "customer_service");
    await page.goto(surface === "card" ? "/leads" : `/leads/${JOB_ID}`);
    await page.getByRole("combobox").filter({ hasText: /^Urgent Job$/ }).first().click();
    await expect(page.getByRole("option", { name: "Partial Paid", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Paid", exact: true })).toHaveCount(0);
  });
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

  test(`${role}: Marshmallow hold card, CX confirmation reason, acknowledgement and bell history`, async ({ page }) => {
    await mockSession(page, role, { hold: true });
    await page.goto("/leads");
    const popup = page.getByRole("complementary", { name: "Operator job hold notifications" });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("Waiting for CX for Schedule Confirmation");
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

test("Admin has one Copy Details switch per user after Manual Lead without duplicate panels", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockSettingsUsers(page);
  const writes: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/set_lead_copy_permission")) writes.push(request.postDataJSON());
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  const matrix = page.getByRole("table");
  expect((await matrix.getByRole("columnheader").allTextContents()).slice(-2)).toEqual(["Manual Lead", "Copy Details"]);
  await expect(matrix.getByRole("columnheader", { name: "Copy Details", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Copy Complete Details", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /User overrides/ })).toHaveCount(0);
  const control = matrix.getByRole("switch", { name: "Copy Details for Synthetic Operator With A Long Display Name", exact: true });
  await expect(control).toBeChecked();
  expect(writes).toEqual([]);
  await control.click();
  await expect(control).not.toBeChecked();
  await expect(matrix.getByRole("switch", { name: "Copy Details for Synthetic Processor", exact: true })).toBeChecked();
  expect(writes).toEqual([{ p_role: null, p_user_id: JOB_ID, p_allowed: false }]);
});

async function mockSettingsUsers(page: Page) {
  await mockSession(page, "admin");
  await page.route("**/rest/v1/user_roles?select=user_id%2Crole", (route) => route.fulfill({ json: [
    { user_id: USER_ID, role: "admin" }, { user_id: JOB_ID, role: "opr" }, { user_id: ALERT_ID, role: "processor" },
  ] }));
  await page.route("**/rest/v1/profiles?select=id%2Cemail%2Cfull_name%2C*", (route) => route.fulfill({ json: [
    { id: USER_ID, full_name: "Synthetic Admin" },
    { id: JOB_ID, full_name: "Synthetic Operator With A Long Display Name" },
    { id: ALERT_ID, full_name: "Synthetic Processor" },
  ] }));
}

for (const width of [1366, 390]) {
  test(`Copy All Details search shows and updates saved user access at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await mockSettingsUsers(page);
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await page.getByLabel("Find feature", { exact: true }).fill("copy all details");
    const control = page.getByRole("switch", { name: "Copy Details for Synthetic Operator With A Long Display Name", exact: true }).filter({ visible: true });
    await expect(control).toBeChecked();
    const target = width >= 1024
      ? page.getByRole("table").getByRole("row").filter({ hasText: "Synthetic Operator With A Long Display Name" })
      : page.getByRole("region", { name: "Feature access for Synthetic Operator With A Long Display Name" });
    await expect(target.getByRole("switch")).toHaveCount(1);
    const request = page.waitForRequest((request) => request.url().endsWith("/rpc/set_lead_copy_permission"));
    await control.click();
    expect((await request).postDataJSON()).toEqual({ p_role: null, p_user_id: JOB_ID, p_allowed: false });
    await expect(control).not.toBeChecked();
    await page.reload();
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await page.getByLabel("Find feature", { exact: true }).fill("Copy Complete Details");
    await expect(control).not.toBeChecked();
    const allow = page.waitForRequest((request) => request.url().endsWith("/rpc/set_lead_copy_permission"));
    await control.click();
    expect((await allow).postDataJSON()).toEqual({ p_role: null, p_user_id: JOB_ID, p_allowed: true });
    await expect(control).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("Copy All Details matrix preserves saved access after a backend rejection", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockSettingsUsers(page);
  await page.route("**/rest/v1/rpc/set_lead_copy_permission", (route) => route.fulfill({
    status: 403, json: { message: "Synthetic copy permission denied", code: "42501" },
  }));
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByLabel("Find feature", { exact: true }).fill("copy all details");
  const target = page.getByRole("table").getByRole("row").filter({ hasText: "Synthetic Operator With A Long Display Name" });
  const control = target.getByRole("switch");
  await expect(control).toBeEnabled();
  await control.click();
  await expect(page.getByText("Synthetic copy permission denied", { exact: true }).first()).toBeVisible();
  await expect(control).toBeChecked();
  await expect(page.getByText("Copy Complete Details access updated", { exact: true })).toHaveCount(0);
});

test("Copy Details switches stay unverified after a read failure and recover through Retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockSettingsUsers(page);
  let failed = true;
  await page.route("**/rest/v1/rpc/get_lead_copy_settings", (route) => route.fulfill(failed
    ? { status: 403, json: { message: "Synthetic copy settings unavailable", code: "42501" } }
    : { json: { roles: [], users: [] } }));
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByLabel("Find feature", { exact: true }).fill("Copy Details");
  const control = page.getByRole("switch", { name: "Copy Details for Synthetic Operator With A Long Display Name", exact: true }).filter({ visible: true });
  await expect(page.getByRole("alert")).toContainText("Synthetic copy settings unavailable");
  await expect(control).toBeDisabled();
  await expect(control).not.toBeChecked();
  failed = false;
  await page.getByRole("button", { name: "Retry permissions", exact: true }).click();
  await expect(control).toBeEnabled();
  await expect(control).toBeChecked();
});

for (const width of [1920, 1440, 1366, 1024, 390]) {
  test(`Feature Access shows all options with contained scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await mockSettingsUsers(page);
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await expect(page.getByRole("button", { name: "Next features" })).toHaveCount(0);
    if (width >= 1024) {
      const initialMatrix = page.getByRole("table");
      expect(await initialMatrix.getByRole("columnheader").count()).toBeGreaterThan(20);
      const scroll = await initialMatrix.evaluate((element) => ({ width: element.parentElement!.clientWidth, content: element.parentElement!.scrollWidth }));
      expect(scroll.content).toBeGreaterThan(scroll.width);
      const region = page.getByRole("region", { name: "Feature permissions table" });
      await region.focus();
      await page.keyboard.press("End");
      await initialMatrix.getByRole("columnheader", { name: "Manual Lead", exact: true }).scrollIntoViewIfNeeded();
      expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect(initialMatrix.getByText("Synthetic Operator With A Long Display Name")).toBeVisible();
    }
    if (width === 1366) await page.screenshot({ path: test.info().outputPath("feature-access-desktop.png") });
    await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
    await expect(page.getByRole("status").filter({ hasText: "features" })).toContainText("2 of");
    await page.getByLabel("Find user", { exact: true }).fill("Synthetic Operator");
    const targetSwitch = page.getByRole("switch", { name: "CX Quickchat for Synthetic Operator With A Long Display Name", exact: true }).filter({ visible: true });
    await expect(targetSwitch).toBeVisible();
    const bounds = await targetSwitch.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width >= 1024) {
      const matrix = page.getByRole("table");
      await expect(matrix).toBeVisible();
      await expect(matrix.getByRole("columnheader")).toHaveCount(3);
      await expect(matrix.getByText("Synthetic Operator With A Long Display Name")).toBeVisible();
      const scroll = await matrix.evaluate((element) => ({ width: element.parentElement!.clientWidth, content: element.parentElement!.scrollWidth }));
      expect(scroll.content).toBeLessThanOrEqual(scroll.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByLabel("Find user", { exact: true }).fill("No such user");
    await expect(page.getByText(/No matching users/)).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByLabel("Find user", { exact: true })).toHaveValue("");
    if (width >= 1024) expect(await page.getByRole("table").getByRole("columnheader").count()).toBeGreaterThan(20);
  });
}

test("Feature Access labels fixed permissions instead of offering ineffective toggles", async ({ page }) => {
  await mockSettingsUsers(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByLabel("Find feature", { exact: true }).fill("Optimization");
  const matrix = page.getByRole("table");
  await expect(matrix.getByText("Admin only")).toHaveCount(2);
  await expect(matrix.getByRole("switch")).toHaveCount(0);
  await page.getByLabel("Find feature", { exact: true }).fill("Cancellation");
  const processor = matrix.getByRole("row").filter({ hasText: "Synthetic Processor" });
  await expect(processor).toContainText("Allowed");
  await expect(processor).toContainText("Included with role");
  await expect(processor.getByRole("switch")).toHaveCount(0);
});

for (const width of [1366, 390]) {
  test(`Feature Access grants and revokes only the selected user's feature at ${width}px`, async ({ page }) => {
    await mockSettingsUsers(page);
    await page.setViewportSize({ width, height: 900 });
    const saved = { id: REVISION_ID, user_id: JOB_ID, nav_section: "quick_chat", allowed: false };
    const writes: { allowed: boolean }[] = [];
    await page.route("**/rest/v1/navigation_permissions*", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: [saved] });
      expect(route.request().method()).toBe("PATCH");
      expect(new URL(route.request().url()).searchParams.get("id")).toBe(`eq.${REVISION_ID}`);
      const change = route.request().postDataJSON();
      writes.push(change);
      saved.allowed = change.allowed;
      return route.fulfill({ json: null });
    });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
    const target = page.getByRole("switch", { name: "CX Quickchat for Synthetic Operator With A Long Display Name", exact: true }).filter({ visible: true });
    const other = page.getByRole("switch", { name: "CX Quickchat for Synthetic Processor", exact: true }).filter({ visible: true });
    await expect(target).not.toBeChecked();
    await target.click();
    await expect(target).toBeChecked();
    await expect(other).not.toBeChecked();
    await target.click();
    await expect(target).not.toBeChecked();
    await expect(other).not.toBeChecked();
    expect(writes).toEqual([{ allowed: true }, { allowed: false }]);
    await page.reload();
    await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
    await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
    await expect(target).not.toBeChecked();
  });
}

test("Feature Access reports a failed navigation save without success or access change", async ({ page }) => {
  await mockSettingsUsers(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/rest/v1/navigation_permissions*", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    return route.fulfill({ status: 403, json: { message: "Synthetic permission denied", code: "42501" } });
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
  const control = page.getByRole("table").getByRole("switch", { name: "CX Quickchat for Synthetic Operator With A Long Display Name", exact: true });
  await expect(control).not.toBeChecked();
  await control.click();
  await expect(page.getByText("Synthetic permission denied", { exact: true }).first()).toBeVisible();
  await expect(control).not.toBeChecked();
  await expect(page.getByText("Navigation permission updated", { exact: true })).toHaveCount(0);
});

test("Feature Access does not offer unverified grants when navigation loading fails", async ({ page }) => {
  await mockSettingsUsers(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/rest/v1/navigation_permissions*", (route) => route.fulfill({
    status: 403, json: { message: "Synthetic permissions unavailable", code: "42501" },
  }));
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Feature Access", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Navigation permissions could not be loaded" })).toBeVisible();
  await page.getByLabel("Find feature", { exact: true }).fill("Quickchat");
  await expect(page.getByRole("table").getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("table").getByText("Unavailable", { exact: true })).toHaveCount(4);
  await page.route("**/rest/v1/navigation_permissions*", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Retry navigation permissions" }).click();
  await expect(page.getByRole("table").getByRole("switch")).toHaveCount(4);
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
