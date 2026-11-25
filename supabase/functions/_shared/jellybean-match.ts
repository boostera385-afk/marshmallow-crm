// Worker that records, for each Marshmallow lead, whether the customer was
// already a JellyBean lead (by phone) when Marshmallow added them, and which
// JellyBean department brought them in. Called every minute by pg_cron only
// when a lead is waiting (see 20261231000800_jellybean_lead_departments.sql).
//
// Auth: x-cron-secret must equal the Vault secret (checked in the database by
// jellybean_match_worker_authorized, so the value never leaves Postgres).
// JellyBean is reached through its marshmallow-lead-lookup function with the
// JELLYBEAN_LOOKUP_SECRET shared secret; no JellyBean keys live here.
//
// Failure handling: if JellyBean is unreachable the batch is NOT saved, so the
// leads stay pending and the next cron run retries them. A lookup failure is
// never recorded as "not in JellyBean".

export const JELLYBEAN_LOOKUP_DEFAULT_URL =
  "https://fjscqsatzsmfivpczaud.supabase.co/functions/v1/marshmallow-lead-lookup";
export const BATCH_SIZE = 200;
const MAX_BATCHES = 5;
const BUDGET_MS = 40_000;
const LOOKUP_TIMEOUT_MS = 20_000;
const DEPARTMENTS = new Set(["ND", "FB", "SEO", "Other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Candidate = {
  id: string;
  created_at: string;
  customer_phone: string | null;
  customer_landline: string | null;
};
export type MatchRow = {
  lead_id: string;
  match_status: "matched" | "not_found" | "no_phone";
  department: string | null;
  jellybean_lead_id: string | null;
  jellybean_created_at: string | null;
  source_role: string | null;
  matched_phone: string | null;
  customer_phone: string | null;
  customer_landline: string | null;
};
type RpcResult = { data: unknown; error: unknown };
export type MatchDeps = {
  env: (name: string) => string | undefined;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  fetch: typeof fetch;
  now?: () => number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Same rule as JellyBean's lead_ai_phone(): E.164 for US/intl numbers, else null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || !/^[\s()+.\-0-9]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^\s*\+[1-9]/.test(raw) && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function leadPhones(lead: Candidate): string[] {
  return [...new Set([normalizePhone(lead.customer_phone), normalizePhone(lead.customer_landline)].filter((p): p is string => !!p))];
}

type LookupMatch = {
  key: string;
  jellybean_lead_id?: string;
  jellybean_created_at?: string;
  source_role?: string | null;
  department?: string;
  matched_phone?: string;
};

/** Builds the rows to save for one batch, or throws when JellyBean could not answer. */
export async function matchBatch(deps: MatchDeps, leads: Candidate[]): Promise<MatchRow[]> {
  const base = (lead: Candidate) => ({
    lead_id: lead.id, department: null, jellybean_lead_id: null, jellybean_created_at: null,
    source_role: null, matched_phone: null, customer_phone: lead.customer_phone, customer_landline: lead.customer_landline,
  });
  const requests = leads
    .map((lead) => ({ key: lead.id, phones: leadPhones(lead), before: lead.created_at }))
    .filter((request) => request.phones.length > 0);
  const found = new Map<string, LookupMatch>();
  if (requests.length) {
    const secret = deps.env("JELLYBEAN_LOOKUP_SECRET");
    if (!secret) throw new Error("JellyBean lookup is not configured.");
    const response = await deps.fetch(deps.env("JELLYBEAN_LOOKUP_URL") || JELLYBEAN_LOOKUP_DEFAULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-marshmallow-secret": secret },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`JellyBean lookup failed (${response.status}).`);
    const body = await response.json().catch(() => null) as { matches?: unknown } | null;
    if (!body || !Array.isArray(body.matches)) throw new Error("JellyBean lookup returned an unexpected response.");
    for (const match of body.matches as LookupMatch[]) {
      if (match && typeof match.key === "string") found.set(match.key, match);
    }
  }
  return leads.map((lead): MatchRow => {
    if (!leadPhones(lead).length) return { ...base(lead), match_status: "no_phone" };
    const match = found.get(lead.id);
    if (!match) return { ...base(lead), match_status: "not_found" };
    return {
      ...base(lead),
      match_status: "matched",
      department: DEPARTMENTS.has(match.department ?? "") ? match.department! : "Other",
      jellybean_lead_id: typeof match.jellybean_lead_id === "string" && UUID.test(match.jellybean_lead_id) ? match.jellybean_lead_id : null,
      jellybean_created_at: typeof match.jellybean_created_at === "string" ? match.jellybean_created_at : null,
      source_role: typeof match.source_role === "string" ? match.source_role.slice(0, 64) : null,
      matched_phone: typeof match.matched_phone === "string" ? match.matched_phone.slice(0, 32) : null,
    };
  });
}

export function createJellybeanMatchHandler(deps: MatchDeps) {
  const now = deps.now ?? Date.now;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const provided = req.headers.get("x-cron-secret") ?? "";
    if (!provided) return json({ error: "Invalid cron secret." }, 401);
    const auth = await deps.rpc("jellybean_match_worker_authorized", { p_secret: provided });
    if (auth.error) return json({ error: "Worker migration is not installed." }, 503);
    if (auth.data !== true) return json({ error: "Invalid cron secret." }, 401);
    if (!deps.env("JELLYBEAN_LOOKUP_SECRET")) return json({ error: "JellyBean lookup is not configured." }, 503);

    const started = now();
    const totals = { checked: 0, matched: 0, not_found: 0, no_phone: 0, batches: 0 };
    while (totals.batches < MAX_BATCHES && now() - started < BUDGET_MS) {
      const { data, error } = await deps.rpc("jellybean_match_candidates", { p_limit: BATCH_SIZE });
      if (error || !Array.isArray(data)) return json({ error: "Could not read pending leads.", ...totals }, 503);
      const leads = (data as Candidate[]).filter((lead) => lead && UUID.test(lead.id) && lead.created_at);
      if (!leads.length) break;
      let rows: MatchRow[];
      try {
        rows = await matchBatch(deps, leads);
      } catch (err) {
        // Nothing from this batch is saved: the leads stay pending for the next run.
        return json({ error: err instanceof Error ? err.message : "JellyBean lookup failed.", ...totals }, 502);
      }
      const saved = await deps.rpc("save_jellybean_matches", { p_rows: rows });
      if (saved.error) return json({ error: "Could not save JellyBean matches.", ...totals }, 503);
      totals.batches += 1;
      totals.checked += Number(saved.data) || 0;
      for (const row of rows) totals[row.match_status] += 1;
      // A batch whose phones all changed mid-check saves nothing; stop instead of re-reading it.
      if (!saved.data || leads.length < BATCH_SIZE) break;
    }
    return json(totals);
  };
}
