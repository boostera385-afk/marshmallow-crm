/** Count shown in a small nav badge: exact up to 99, then "99+" so the badge stays compact. */
export function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  return count > 99 ? "99+" : String(Math.floor(count));
}
