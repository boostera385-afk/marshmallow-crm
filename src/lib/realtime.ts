import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * A lightweight global event bus for distributing Supabase Realtime events locally
 * to avoid creating hundreds of WebSocket channels.
 */
export const realtimeBus = new EventTarget();

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationChange = RealtimePostgresChangesPayload<NotificationRow>;
type NotificationSubscription = {
  channel: ReturnType<typeof supabase.channel>;
  consumers: number;
};
const notificationSubscriptions = new Map<string, NotificationSubscription>();
let notificationChannelId = 0;

/** One recipient-filtered transport for the bell and all eligible popups. No row cache. */
export function subscribeToNotifications(userId: string, onChange: (payload: NotificationChange) => void) {
  const eventName = `notifications:${userId}`;
  const listener = (event: Event) => onChange((event as CustomEvent<NotificationChange>).detail);
  realtimeBus.addEventListener(eventName, listener);

  let subscription = notificationSubscriptions.get(userId);
  if (!subscription) {
    // A distinct name also avoids reusing a channel still leaving after a rapid remount.
    const channel = supabase.channel(`notifications:${userId}:${++notificationChannelId}`);
    const entry: NotificationSubscription = { channel, consumers: 0 };
    notificationSubscriptions.set(userId, entry);
    const dispatch = (payload: NotificationChange) => {
      if (notificationSubscriptions.get(userId) !== entry) return;
      realtimeBus.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    };
    channel
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}`,
      }, dispatch)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}`,
      }, dispatch)
      .subscribe();
    subscription = entry;
  }
  subscription.consumers++;
  const entry = subscription;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    realtimeBus.removeEventListener(eventName, listener);
    if (--entry.consumers === 0) {
      notificationSubscriptions.delete(userId);
      void supabase.removeChannel(entry.channel);
    }
  };
}

let isRealtimeSetup = false;
let globalChannel: ReturnType<typeof supabase.channel> | null = null;

export function setupGlobalRealtime() {
  if (isRealtimeSetup) return;
  isRealtimeSetup = true;

  // Single global channel for row-level components
  globalChannel = supabase
    .channel("global-app-events")
    // Lead Notes
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lead_notes" },
      (payload) => {
        realtimeBus.dispatchEvent(new CustomEvent("lead_notes", { detail: payload }));
      }
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "lead_hold_alerts" }, (payload) => {
      realtimeBus.dispatchEvent(new CustomEvent("lead_hold_alerts", { detail: payload }));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "lead_copy_role_permissions" }, () => {
      realtimeBus.dispatchEvent(new Event("lead_copy_role_permissions"));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "lead_copy_user_permissions" }, () => {
      realtimeBus.dispatchEvent(new Event("lead_copy_user_permissions"));
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log("Global Realtime Channel Connected");
      }
      if (err) {
        console.error("Global Realtime Channel Error:", err);
      }
    });
}
