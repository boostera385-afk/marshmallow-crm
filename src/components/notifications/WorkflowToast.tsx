import { useEffect, useState } from "react";
import { Bell, CalendarClock, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InboxNotification } from "@/lib/workflow-inbox";

export default function WorkflowToast({ notification, onOpen, onDismiss }: { notification: InboxNotification; onOpen: () => void; onDismiss: () => void }) {
  const [remaining, setRemaining] = useState(5000);
  const [paused, setPaused] = useState(false);
  // AI schedule results (confirmed, or the customer needs a new schedule) carry job
  // details and stay until dismissed or opened, like the other lead pop-ups;
  // request notices still fade after five seconds.
  const isJob = notification.event_type === "schedule_ready" || notification.event_type === "schedule_new_needed";
  const persistent = isJob;
  useEffect(() => {
    if (paused || persistent) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setRemaining((value) => Math.max(0, value - elapsed));
    }, 100);
    return () => window.clearInterval(timer);
  }, [paused, persistent]);
  useEffect(() => { if (!remaining && !persistent) onDismiss(); }, [remaining, persistent, onDismiss]);
  const Icon = notification.event_type === "schedule_ready" ? CheckCircle2 : notification.event_type === "schedule_new_needed" ? CalendarClock : Bell;
  return <div role="status" className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-primary/20 bg-background shadow-xl"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <div className="flex items-start gap-3 p-4"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{notification.title}</p><p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">{notification.message}</p>
        <Button variant="link" className="h-auto px-0 pt-2" onClick={onOpen}>View {isJob ? "job" : "request"}</Button></div>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Dismiss notification" onClick={onDismiss}><X className="h-4 w-4" /></Button>
    </div>
    {!persistent && <div aria-hidden="true" className="h-1 bg-muted"><div className="h-full bg-primary motion-reduce:transition-none" style={{ width: `${remaining / 50}%` }} /></div>}
  </div>;
}
