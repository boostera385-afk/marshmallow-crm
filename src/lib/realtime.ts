import { supabase } from "@/integrations/supabase/client";

/**
 * A lightweight global event bus for distributing Supabase Realtime events locally
 * to avoid creating hundreds of WebSocket channels.
 */
export const realtimeBus = new EventTarget();

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
