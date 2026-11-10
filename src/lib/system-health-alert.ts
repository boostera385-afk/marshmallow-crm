export type HealthSeverity = "critical" | "warning" | "ok" | "info";

/** Severity from the server's title (supabase/migrations/20261210040000_system_health_alerts.sql). */
export function healthSeverity(title: string): HealthSeverity {
  if (title.startsWith("[Test]")) return "info";
  if (/^\[Alert\] (Database overload critical|Database load still critical)/.test(title)) return "critical";
  if (title.startsWith("[Alert]")) return "warning";
  if (title === "Database load back to normal") return "ok";
  return "info";
}
