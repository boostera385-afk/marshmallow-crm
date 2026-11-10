import { describe, expect, it, vi } from "vitest";
import {
  criticalWithoutDatabase,
  hostSample,
  parsePrometheus,
  parseRecipients,
  sendAlertEmail,
} from "../../supabase/functions/_shared/system-health";

const GB = 1024 ** 3;

/** Synthetic Metrics API output in the Prometheus text format (two services, two CPUs). */
function feed(over: { memAvail?: number; swapFree?: number; idle?: number; iowait?: number; dataAvail?: number } = {}) {
  const memAvail = over.memAvail ?? 0.6 * GB;
  return [
    "# HELP node_memory_MemTotal_bytes Memory information field MemTotal_bytes.",
    "# TYPE node_memory_MemTotal_bytes gauge",
    `node_memory_MemTotal_bytes{service_type="db",supabase_project_ref="ref"} ${2 * GB}`,
    `node_memory_MemTotal_bytes{service_type="pgbouncer",supabase_project_ref="ref"} ${8 * GB}`,
    `node_memory_MemAvailable_bytes{service_type="db",supabase_project_ref="ref"} ${memAvail}`,
    `node_memory_MemAvailable_bytes{service_type="pgbouncer",supabase_project_ref="ref"} ${7 * GB}`,
    `node_memory_SwapTotal_bytes{service_type="db"} ${1 * GB}`,
    `node_memory_SwapFree_bytes{service_type="db"} ${over.swapFree ?? 0.9 * GB}`,
    `node_cpu_seconds_total{cpu="0",mode="idle",service_type="db"} ${over.idle ?? 1000}`,
    `node_cpu_seconds_total{cpu="1",mode="idle",service_type="db"} ${over.idle ?? 1000}`,
    `node_cpu_seconds_total{cpu="0",mode="iowait",service_type="db"} ${over.iowait ?? 50}`,
    `node_cpu_seconds_total{cpu="0",mode="user",service_type="db"} 300`,
    `node_cpu_seconds_total{cpu="1",mode="system",service_type="db"} 150`,
    `node_filesystem_size_bytes{device="/dev/nvme1n1",fstype="ext4",mountpoint="/data",service_type="db"} ${8 * GB}`,
    `node_filesystem_avail_bytes{device="/dev/nvme1n1",fstype="ext4",mountpoint="/data",service_type="db"} ${over.dataAvail ?? 6 * GB}`,
    `node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run",service_type="db"} ${100 * GB}`,
    `node_filesystem_avail_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run",service_type="db"} 1`,
    `node_filesystem_size_bytes{device="/dev/root",fstype="ext4",mountpoint="/",service_type="db"} ${10 * GB}`,
    `node_filesystem_avail_bytes{device="/dev/root",fstype="ext4",mountpoint="/",service_type="db"} ${1 * GB}`,
    "pg_stat_database_xact_commit_total{datname=\"postgres\",service_type=\"db\"} 123 1700000000000",
    "garbage line without value",
  ].join("\n");
}

describe("system health: reading the Metrics API", () => {
  it("parses names, labels and values, skipping comments and bad lines", () => {
    const rows = parsePrometheus('a_metric{x="1",y="q\\"uote"} 2.5\n# c\nbad\nb 3 1700000000');
    expect(rows).toEqual([
      { name: "a_metric", labels: { x: "1", y: 'q"uote' }, value: 2.5 },
      { name: "b", labels: {}, value: 3 },
    ]);
  });

  it("computes memory, swap (of RAM) and data disk for the database host only", () => {
    expect(hostSample(feed(), true)).toEqual({
      metrics_ok: true,
      email_configured: true,
      mem_available_pct: 30,
      swap_used_pct: 5, // 0.1 GB of swap used / 2 GB RAM
      disk_used_pct: 25, // /data, not tmpfs and not the root disk
      cpu_total_seconds: 2500,
      cpu_idle_seconds: 2000,
      cpu_iowait_seconds: 50,
    });
  });

  it("reports the Nov 7/9 pattern: almost no memory, swap close to RAM", () => {
    const s = hostSample(feed({ memAvail: 0.1 * GB, swapFree: 0 }), false);
    expect(s).toMatchObject({ mem_available_pct: 5, swap_used_pct: 50, email_configured: false });
  });

  it("is 'unavailable', not fine, when memory numbers are missing", () => {
    expect(hostSample("node_cpu_seconds_total{mode=\"idle\"} 5", true)).toEqual({
      metrics_ok: false,
      metrics_error: "memory metrics missing from the feed",
      email_configured: true,
    });
  });

  it("uses unlabelled series when the feed has no service labels", () => {
    const s = hostSample(`node_memory_MemTotal_bytes ${4 * GB}\nnode_memory_MemAvailable_bytes ${1 * GB}`, true);
    expect(s).toMatchObject({ metrics_ok: true, mem_available_pct: 25 });
    expect(s.swap_used_pct).toBeUndefined();
  });
});

describe("system health: alerting without the database", () => {
  it("names only the critical readings", () => {
    expect(criticalWithoutDatabase(hostSample(feed({ memAvail: 0.1 * GB, swapFree: 0 }), true)))
      .toEqual(["memory 5% free"]);
    expect(criticalWithoutDatabase(hostSample(feed({ memAvail: 0.1 * GB, swapFree: 0 }), true), { memAvailablePct: 10, swapPct: 40, diskPct: 90 }))
      .toEqual(["memory 5% free", "swap 50% of RAM"]);
    expect(criticalWithoutDatabase(hostSample(feed(), true))).toEqual([]);
    expect(criticalWithoutDatabase({ metrics_ok: false, email_configured: true })).toEqual([]);
  });
});

describe("system health: email", () => {
  it("keeps only valid, unique addresses", () => {
    expect(parseRecipients(" a@x.com, b@y.org;a@x.com  not-an-email ")).toEqual(["a@x.com", "b@y.org"]);
    expect(parseRecipients(undefined)).toEqual([]);
  });

  it("sends through Resend with the key in the header only", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const out = await sendAlertEmail(fetchFn as unknown as typeof fetch, "re_synthetic", "Alerts <a@x.com>", ["b@y.org"], { subject: "S", text: "T" });
    expect(out).toBe("sent");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_synthetic");
    expect(JSON.parse(String(init.body))).toEqual({ from: "Alerts <a@x.com>", to: ["b@y.org"], subject: "S", text: "T" });
  });

  it("reports failures without throwing or leaking the key", async () => {
    const failing = vi.fn(async () => new Response("bad", { status: 403 }));
    expect(await sendAlertEmail(failing as unknown as typeof fetch, "re_synthetic", "a@x.com", ["b@y.org"], { subject: "S", text: "T" }))
      .toBe("email failed: HTTP 403");
    const throwing = vi.fn(async () => { throw new TypeError("network re_synthetic"); });
    const out = await sendAlertEmail(throwing as unknown as typeof fetch, "re_synthetic", "a@x.com", ["b@y.org"], { subject: "S", text: "T" });
    expect(out).toBe("email failed: TypeError");
    expect(await sendAlertEmail(failing as unknown as typeof fetch, "", "a@x.com", ["b@y.org"], { subject: "S", text: "T" })).toBe("not configured");
  });
});
