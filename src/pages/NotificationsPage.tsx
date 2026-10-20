import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessNotifications } from "@/lib/access";
import { useNotificationInbox } from "@/hooks/useNotificationInbox";
import { markInboxRead, openInboxNotification, type InboxFilters, type InboxNotification } from "@/lib/workflow-inbox";
import { realtimeBus } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NotificationSoundControls from "@/components/notifications/NotificationSoundControls";

const initial: InboxFilters = { view: "all", category: "all", search: "" };
export default function NotificationsPage() {
  const { role, user } = useAuth();
  const scope = `${user?.id}:${role}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const navigate = useNavigate();
  const [filters, setFilters] = useState<InboxFilters>(initial);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const query = useNotificationInbox(filters, offset);
  const refresh = () => { void query.refetch(); realtimeBus.dispatchEvent(new Event("workflow-inbox-read")); };
  const filter = (patch: Partial<InboxFilters>) => { setOffset(0); setFilters((previous) => ({ ...previous, ...patch })); };
  const read = async (notification?: InboxNotification) => {
    if (saving) return;
    setSaving(true);
    try {
      if (notification) {
        const href = await openInboxNotification(notification);
        if (currentScope.current !== scope) return;
        if (href) navigate(href);
      } else await markInboxRead(query.data?.rows.filter((row) => !row.read).map((row) => row.id) ?? []);
      if (currentScope.current === scope) refresh();
    } catch (error) { if (currentScope.current === scope) toast.error(error instanceof Error ? error.message : "Could not update notifications"); }
    finally { setSaving(false); }
  };
  if (!canAccessNotifications(role)) return <p role="alert">You do not have access to notification history.</p>;
  return <section className="mx-auto max-w-5xl space-y-5" aria-label="Notification history" key={`${user?.id}:${role}`}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Bell className="h-6 w-6 text-primary" />Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your authorized updates and complete notification history. Reading does not resolve work.</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </header>
    <NotificationSoundControls />
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Notification views">
        {(["all", "unread", "action"] as const).map((view) => <Button key={view} variant={filters.view === view ? "default" : "outline"} aria-pressed={filters.view === view} size="sm" onClick={() => filter({ view })}>
          {{ all: "All", unread: "Unread", action: "Action required" }[view]}</Button>)}
        {query.data && <span className="text-xs text-muted-foreground">{query.data.unread_count} unread · {query.data.total} matching</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="notification-category">Category</Label><select id="notification-category" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={filters.category} onChange={(event) => filter({ category: event.target.value as InboxFilters["category"] })}>
          <option value="all">All notifications</option><option value="cx">CX updates</option><option value="tech">Tech updates</option><option value="schedule">Scheduling</option><option value="other">Other</option></select></div>
        <form onSubmit={(event) => { event.preventDefault(); filter({ search: search.trim() }); }}><Label htmlFor="notification-search">Job ID or notification</Label><div className="mt-1 flex gap-1"><Input id="notification-search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search history" /><Button type="submit" variant="outline" size="sm" className="h-10">Find</Button></div></form>
        <div><Label htmlFor="notification-since">From</Label><Input id="notification-since" className="mt-1" type="date" onChange={(event) => filter({ since: event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : undefined })} /></div>
        <div><Label htmlFor="notification-until">Through</Label><Input id="notification-until" className="mt-1" type="date" onChange={(event) => { const value = event.target.value; const end = value ? new Date(`${value}T00:00:00`) : null; if (end) end.setDate(end.getDate() + 1); filter({ until: end?.toISOString() }); }} /></div>
      </div>
    </div>
    {query.isError ? <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">Notifications unavailable. {query.error.message}<Button variant="outline" className="ml-2" onClick={refresh}>Retry</Button></div>
      : query.isPending ? <p role="status">Loading notifications…</p>
      : <>
        <div className="flex justify-end"><Button variant="outline" size="sm" disabled={saving || !query.data.rows.some((row) => !row.read)} onClick={() => { void read(); }}><CheckCheck className="mr-2 h-4 w-4" />Mark this page read</Button></div>
        {!query.data.rows.length ? <p role="status" className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No notifications match these filters.</p>
          : <div className="divide-y overflow-hidden rounded-xl border bg-card">{query.data.rows.map((notification) => <button key={notification.id} disabled={saving} onClick={() => { void read(notification); }} className={`flex w-full gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${notification.read ? "" : "bg-primary/5"}`}>
            <Bell className="mt-1 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className={`text-sm ${notification.read ? "font-medium" : "font-semibold"}`}>{!notification.read && <span aria-label="Unread">● </span>}{notification.title}</h2>
              {notification.action_required && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Action required</span>}</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{notification.message}</p><p className="mt-2 text-xs text-muted-foreground">{notification.job_id && `${notification.job_id} · `}{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</p></div>
          </button>)}</div>}
        <nav aria-label="Notification pages" className="flex items-center justify-center gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><span className="text-sm">Page {Math.floor(offset / 20) + 1}</span><Button variant="outline" disabled={offset + 20 >= query.data.total} onClick={() => setOffset(offset + 20)}>Next</Button></nav>
      </>}
  </section>;
}
