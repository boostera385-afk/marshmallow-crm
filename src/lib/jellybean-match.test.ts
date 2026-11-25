// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  BATCH_SIZE,
  createJellybeanMatchHandler,
  JELLYBEAN_LOOKUP_DEFAULT_URL,
  normalizePhone,
  type Candidate,
  type MatchRow,
} from "../../supabase/functions/_shared/jellybean-match";

const CRON = "vault-cron-secret";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lead = (n: number, phone: string | null, landline: string | null = null): Candidate => ({
  id: id(n), created_at: `2026-11-${String(n % 28 + 1).padStart(2, "0")}T10:00:00Z`, customer_phone: phone, customer_landline: landline,
});

function setup(options: {
  pending?: Candidate[];
  authorized?: boolean;
  authError?: boolean;
  lookupSecret?: string | null;
  lookup?: (body: { requests: { key: string; phones: string[]; before: string }[] }) => Response;
  saveError?: boolean;
  candidatesError?: boolean;
} = {}) {
  let pending = [...(options.pending ?? [])];
  const saved: MatchRow[][] = [];
  const lookups: { url: string; headers: Record<string, string>; body: { requests: { key: string; phones: string[]; before: string }[] } }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "jellybean_match_worker_authorized") {
      return options.authError ? { data: null, error: new Error("missing") } : { data: (options.authorized ?? true) && args.p_secret === CRON, error: null };
    }
    if (fn === "jellybean_match_candidates") {
      return options.candidatesError ? { data: null, error: new Error("db") } : { data: pending.slice(0, Number(args.p_limit)), error: null };
    }
    if (fn === "save_jellybean_matches") {
      if (options.saveError) return { data: null, error: new Error("db") };
      const rows = args.p_rows as MatchRow[];
      saved.push(rows);
      pending = pending.filter((p) => !rows.some((r) => r.lead_id === p.id));
      return { data: rows.length, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    lookups.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    return options.lookup ? options.lookup(body) : Response.json({ matches: [] });
  });
  const handler = createJellybeanMatchHandler({
    env: (name) => name === "JELLYBEAN_LOOKUP_SECRET" ? (options.lookupSecret === null ? undefined : options.lookupSecret ?? "shared") : undefined,
    rpc,
    fetch: fetchMock as unknown as typeof fetch,
  });
  const call = (secret: string | null = CRON, method = "POST") => handler(new Request("https://m.test/functions/v1/jellybean-match-leads", {
    method, headers: secret === null ? {} : { "x-cron-secret": secret },
  }));
  return { call, rpc, fetchMock, saved, lookups, pendingIds: () => pending.map((p) => p.id) };
}

describe("normalizePhone (mirrors JellyBean lead_ai_phone)", () => {
  it.each([
    ["(404) 555-0101", "+14045550101"],
    ["1-404-555-0101", "+14045550101"],
    ["+44 20 7946 0958", "+442079460958"],
    ["404.555.0101", "+14045550101"],
    ["555-0101", null],
    ["404 555 0101 ext 2", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (raw, expected) => expect(normalizePhone(raw)).toBe(expected));
});

describe("jellybean-match-leads worker", () => {
  it("saves ND/FB/SEO departments for matched leads and 'not found' for the rest", async () => {
    const leads = [lead(1, "(404) 555-0101"), lead(2, "4045550102", "4045550199"), lead(3, "4045550103"), lead(4, "4045550104")];
    const t = setup({
      pending: leads,
      lookup: () => Response.json({ matches: [
        { key: id(1), department: "ND", source_role: "maturing", jellybean_lead_id: id(91), jellybean_created_at: "2026-10-01T00:00:00Z", matched_phone: "+14045550101" },
        { key: id(2), department: "FB", source_role: "facebook", matched_phone: "+14045550199" },
        { key: id(3), department: "SEO", source_role: "seo" },
      ] }),
    });
    const res = await t.call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 4, matched: 3, not_found: 1, no_phone: 0, batches: 1 });
    const rows = Object.fromEntries(t.saved[0].map((r) => [r.lead_id, r]));
    expect(rows[id(1)]).toMatchObject({ match_status: "matched", department: "ND", jellybean_lead_id: id(91), customer_phone: "(404) 555-0101" });
    expect(rows[id(2)]).toMatchObject({ match_status: "matched", department: "FB", customer_landline: "4045550199" });
    expect(rows[id(3)]).toMatchObject({ match_status: "matched", department: "SEO" });
    expect(rows[id(4)]).toMatchObject({ match_status: "not_found", department: null });
    expect(t.pendingIds()).toEqual([]);
  });

  it("sends normalised phones, the lead's creation time and the shared secret to JellyBean", async () => {
    const t = setup({ pending: [lead(2, "404-555-0102", "(404) 555-0102")] });
    await t.call();
    expect(t.lookups).toHaveLength(1);
    expect(t.lookups[0].url).toBe(JELLYBEAN_LOOKUP_DEFAULT_URL);
    expect(t.lookups[0].headers["x-marshmallow-secret"]).toBe("shared");
    expect(t.lookups[0].body.requests).toEqual([{ key: id(2), phones: ["+14045550102"], before: lead(2, null).created_at }]);
  });

  it("records leads with no usable phone without calling JellyBean", async () => {
    const t = setup({ pending: [lead(5, null), lead(6, "n/a")] });
    expect(await (await t.call()).json()).toMatchObject({ no_phone: 2, matched: 0, not_found: 0 });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("maps an unknown department to Other rather than dropping the match", async () => {
    const t = setup({ pending: [lead(7, "4045550107")], lookup: () => Response.json({ matches: [{ key: id(7), department: "TikTok" }] }) });
    await t.call();
    expect(t.saved[0][0]).toMatchObject({ match_status: "matched", department: "Other" });
  });

  it("keeps leads pending (saves nothing) when JellyBean fails, instead of marking them not found", async () => {
    for (const lookup of [() => new Response("down", { status: 502 }), () => Response.json({ nope: true })]) {
      const t = setup({ pending: [lead(1, "4045550101")], lookup });
      const res = await t.call();
      expect(res.status).toBe(502);
      expect(t.saved).toEqual([]);
      expect(t.pendingIds()).toEqual([id(1)]);
    }
  });

  it("refuses a missing or wrong cron secret before reading any lead", async () => {
    const t = setup({ pending: [lead(1, "4045550101")] });
    expect((await t.call(null)).status).toBe(401);
    expect((await t.call("wrong")).status).toBe(401);
    expect(t.rpc.mock.calls.map(([fn]) => fn)).toEqual(["jellybean_match_worker_authorized"]);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing configuration and backend failures distinctly", async () => {
    expect((await setup({ authError: true }).call()).status).toBe(503);
    expect((await setup({ lookupSecret: null, pending: [lead(1, "4045550101")] }).call()).status).toBe(503);
    expect((await setup({ candidatesError: true }).call()).status).toBe(503);
    const failedSave = setup({ saveError: true, pending: [lead(1, "4045550101")] });
    expect((await failedSave.call()).status).toBe(503);
    expect((await setup().call(CRON, "GET")).status).toBe(405);
  });

  it("backfills in batches of 200 with one JellyBean request per batch and stops when nothing is pending", async () => {
    const many = Array.from({ length: BATCH_SIZE * 2 + 50 }, (_, i) => lead(i + 1, `404555${String(i).padStart(4, "0")}`));
    const t = setup({ pending: many });
    expect(await (await t.call()).json()).toMatchObject({ checked: 450, batches: 3 });
    expect(t.lookups.map((l) => l.body.requests.length)).toEqual([200, 200, 50]);
    expect(t.pendingIds()).toEqual([]);
  });

  it("does nothing when no lead is pending", async () => {
    const t = setup({ pending: [] });
    expect(await (await t.call()).json()).toEqual({ checked: 0, matched: 0, not_found: 0, no_phone: 0, batches: 0 });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });
});
