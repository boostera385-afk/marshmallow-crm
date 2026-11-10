// =============================================================================
// Overload early warning: read the database host's memory, swap, CPU and disk
// from Supabase's Metrics API (Prometheus text) and turn them into the sample
// that public.record_system_health() judges. Pure functions only, so they are
// unit tested in src/lib/system-health.test.ts.
// =============================================================================

export interface PromSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** The numbers record_system_health() needs. Counters are raw; the database turns them into rates. */
export interface HealthSample {
  metrics_ok: boolean;
  metrics_error?: string;
  email_configured: boolean;
  mem_available_pct?: number;
  swap_used_pct?: number;
  disk_used_pct?: number;
  cpu_total_seconds?: number;
  cpu_idle_seconds?: number;
  cpu_iowait_seconds?: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\S+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** Parses the Prometheus text format; comments and malformed lines are skipped. */
export function parsePrometheus(text: string, wanted?: ReadonlySet<string>): PromSeries[] {
  const out: PromSeries[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    if (wanted && !wanted.has(m[1])) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    if (m[2]) for (const l of m[2].matchAll(LABEL)) labels[l[1]] = l[2].replace(/\\(.)/g, "$1");
    out.push({ name: m[1], labels, value });
  }
  return out;
}

export const HOST_METRICS = new Set([
  "node_memory_MemTotal_bytes",
  "node_memory_MemAvailable_bytes",
  "node_memory_SwapTotal_bytes",
  "node_memory_SwapFree_bytes",
  "node_cpu_seconds_total",
  "node_filesystem_size_bytes",
  "node_filesystem_avail_bytes",
]);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** When the feed labels series by service, only the database host counts. */
function dbOnly(series: PromSeries[]): PromSeries[] {
  const labelled = series.some((s) => "service_type" in s.labels);
  return labelled ? series.filter((s) => s.labels.service_type === "db") : series;
}

const one = (series: PromSeries[], name: string) => series.find((s) => s.name === name)?.value;

/** The database's data disk: /data when present, otherwise the largest real filesystem. */
function diskUsedPct(series: PromSeries[]): number | undefined {
  const real = (s: PromSeries) => !/^(tmpfs|devtmpfs|overlay|squashfs)$/.test(s.labels.fstype ?? "");
  const sizes = series.filter((s) => s.name === "node_filesystem_size_bytes" && real(s) && s.value > 0);
  const pick = sizes.find((s) => s.labels.mountpoint === "/data") ?? [...sizes].sort((a, b) => b.value - a.value)[0];
  if (!pick) return undefined;
  const avail = series.find((s) => s.name === "node_filesystem_avail_bytes" && s.labels.mountpoint === pick.labels.mountpoint
    && (s.labels.device ?? "") === (pick.labels.device ?? ""));
  if (!avail) return undefined;
  return round1(100 * (1 - avail.value / pick.value));
}

/** Turns the raw feed into a sample. Missing memory numbers make the sample "unavailable". */
export function hostSample(text: string, emailConfigured: boolean): HealthSample {
  const series = dbOnly(parsePrometheus(text, HOST_METRICS));
  const memTotal = one(series, "node_memory_MemTotal_bytes");
  const memAvail = one(series, "node_memory_MemAvailable_bytes");
  if (!memTotal || memAvail === undefined) {
    return { metrics_ok: false, metrics_error: "memory metrics missing from the feed", email_configured: emailConfigured };
  }
  const sample: HealthSample = {
    metrics_ok: true,
    email_configured: emailConfigured,
    mem_available_pct: round1((100 * memAvail) / memTotal),
  };
  const swapTotal = one(series, "node_memory_SwapTotal_bytes");
  const swapFree = one(series, "node_memory_SwapFree_bytes");
  if (swapTotal !== undefined && swapFree !== undefined) sample.swap_used_pct = round1((100 * (swapTotal - swapFree)) / memTotal);
  const cpu = series.filter((s) => s.name === "node_cpu_seconds_total");
  if (cpu.length) {
    const sum = (mode?: string) => cpu.filter((s) => !mode || s.labels.mode === mode).reduce((t, s) => t + s.value, 0);
    sample.cpu_total_seconds = sum();
    sample.cpu_idle_seconds = sum("idle");
    sample.cpu_iowait_seconds = sum("iowait");
  }
  const disk = diskUsedPct(series);
  if (disk !== undefined) sample.disk_used_pct = disk;
  return sample;
}

/** Same defaults as marshmallow_private.health_policy (critical levels). */
export const CRITICAL_DEFAULTS = { memAvailablePct: 10, swapPct: 60, diskPct: 90 };

/**
 * Used only when the database cannot be reached: is the host already in the
 * outage pattern? (No history is available, so only instant readings count.)
 */
export function criticalWithoutDatabase(sample: HealthSample, limits = CRITICAL_DEFAULTS): string[] {
  if (!sample.metrics_ok) return [];
  const reasons: string[] = [];
  if (sample.mem_available_pct !== undefined && sample.mem_available_pct <= limits.memAvailablePct) reasons.push(`memory ${sample.mem_available_pct}% free`);
  if (sample.swap_used_pct !== undefined && sample.swap_used_pct >= limits.swapPct) reasons.push(`swap ${sample.swap_used_pct}% of RAM`);
  if (sample.disk_used_pct !== undefined && sample.disk_used_pct >= limits.diskPct) reasons.push(`disk ${sample.disk_used_pct}% full`);
  return reasons;
}

/** Comma/space separated list of addresses; anything that is not an address is dropped. */
export function parseRecipients(value: string | undefined | null): string[] {
  return [...new Set((value ?? "").split(/[,;\s]+/).map((v) => v.trim()).filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)))];
}

export interface EmailMessage {
  subject: string;
  text: string;
}

/** Sends through Resend's HTTPS API. Returns "sent" or a short reason (never the key). */
export async function sendAlertEmail(
  fetchFn: typeof fetch,
  apiKey: string,
  from: string,
  to: string[],
  message: EmailMessage,
): Promise<"sent" | string> {
  if (!apiKey || to.length === 0) return "not configured";
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: message.subject.slice(0, 200), text: message.text }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
    });
    return res.ok ? "sent" : `email failed: HTTP ${res.status}`;
  } catch (error) {
    return `email failed: ${error instanceof Error ? error.name : "error"}`;
  }
}
