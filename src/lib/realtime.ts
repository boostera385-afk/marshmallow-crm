import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { forgetRealtimeChannel, reportRealtimeStatus } from "@/lib/realtime-health";
import { setServerLoadLevel } from "@/lib/overload-guard";
import { browserLocks, type ChannelLike } from "@/lib/cross-tab";
import { createRealtimeRelay, type RealtimeEvent, type RealtimeRelay, type TableBinding } from "@/lib/realtime-relay";

/**
 * A lightweight global event bus for distributing Supabase Realtime events locally
 * to avoid creating hundreds of WebSocket channels.
 */
export const realtimeBus = new EventTarget();

/** Opens a real Postgres Changes channel for the relay (leader tab only). */
function openSupabaseChannel(
  name: string,
  bindings: TableBinding[],
  onPayload: (bindingIndex: number, payload: unknown) => void,
  onStatus: (status: string) => void,
) {
  const channel = supabase.channel(name);
  bindings.forEach((binding, index) => {
    channel.on(
      // The overloads only accept literal events; bindings are validated by type.
      "postgres_changes" as never,
      { event: binding.event, schema: "public", table: binding.table, ...(binding.filter ? { filter: binding.filter } : {}) },
      (payload: unknown) => onPayload(index, payload),
    );
  });
  channel.subscribe((status) => onStatus(status));
  return () => { void supabase.removeChannel(channel); };
}

let relay: RealtimeRelay | null = null;
/** The tab's relay: one real channel per subscription per browser (see realtime-relay). */
export function realtimeRelay(): RealtimeRelay {
  relay ??= createRealtimeRelay({
    locks: browserLocks(),
    createChannel: typeof BroadcastChannel === "function" ? (name) => new BroadcastChannel(name) as unknown as ChannelLike : null,
    openChannel: openSupabaseChannel,
    reportStatus: reportRealtimeStatus,
    forgetStatus: forgetRealtimeChannel,
  });
  return relay;
}
/** Test hook: install a relay (or reset to the browser one with null). */
export function setRealtimeRelay(next: RealtimeRelay | null) {
  relay = next;
}

/**
 * Follow one table's changes (optionally one event and filter) while the
 * returned release is held. Every consumer in every tab of the browser shares
 * one subscription; it opens with the first consumer and closes with the last.
 */
export function subscribeToTableChanges<T = unknown>(
  table: string,
  onChange: (payload: T) => void,
  options: { event?: RealtimeEvent; filter?: string } = {},
) {
  const event = options.event ?? "*";
  const key = `table:${table}:${event}:${options.filter ?? ""}`;
  return realtimeRelay().subscribe(
    { key, bindings: [{ event, table, ...(options.filter ? { filter: options.filter } : {}) }], healthName: key },
    (payload) => onChange(payload as T),
  );
}

/**
 * Mirror a table's changes onto realtimeBus (event name = table, payload in
 * `detail`) while held. Screens that already listen on the bus mount this so
 * the table is only subscribed while something that uses it is on screen.
 */
export function relayTableToBus(table: string) {
  return subscribeToTableChanges(table, (payload) => {
    realtimeBus.dispatchEvent(new CustomEvent(table, { detail: payload }));
  });
}

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationChange = RealtimePostgresChangesPayload<NotificationRow>;

/** One recipient-filtered transport for the bell and all eligible popups, shared across tabs. No row cache. */
export function subscribeToNotifications(userId: string, onChange: (payload: NotificationChange) => void) {
  return realtimeRelay().subscribe(
    {
      key: `notifications:${userId}`,
      healthName: "notifications",
      bindings: [
        { event: "INSERT", table: "notifications", filter: `user_id=eq.${userId}` },
        { event: "UPDATE", table: "notifications", filter: `user_id=eq.${userId}` },
      ],
    },
    (payload) => onChange(payload as NotificationChange),
  );
}

type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
export type LeadChange = RealtimePostgresChangesPayload<LeadRow>;

/**
 * Every screen that follows all lead changes shares ONE `leads` subscription
 * per browser (see realtime-relay). Each subscription costs the database a
 * security check per changed row and the Realtime service memory, so screens
 * (Leads, Map, Schedule, Areas, Quote Pending, Processor Board, nearby-urgent)
 * and tabs each opening their own multiplied that work for the same events.
 * Consumers get the same payloads, instantly; the subscription closes when the
 * last consumer in the last tab unmounts.
 */
export function subscribeToLeadChanges(onChange: (payload: LeadChange) => void) {
  return realtimeRelay().subscribe(
    { key: "leads:all", healthName: "leads", bindings: [{ event: "*", table: "leads" }] },
    (payload) => onChange(payload as LeadChange),
  );
}

let isRealtimeSetup = false;
let globalChannel: ReturnType<typeof supabase.channel> | null = null;
let processorBoardConsumers = 0;
let processorBoardChannel: ReturnType<typeof supabase.channel> | null = null;
let processorBoardGeneration = 0;
let processorBoardLeadsRelease: (() => void) | null = null;

/** Mounted Processor Board consumers share one transport; no board traffic for other screens/roles. */
export function subscribeToProcessorBoard(onChange: () => void) {
  realtimeBus.addEventListener("processor_board_changed", onChange);
  processorBoardConsumers++;
  if (!processorBoardChannel) {
    const generation = ++processorBoardGeneration;
    const dispatch = () => {
      if (generation === processorBoardGeneration) realtimeBus.dispatchEvent(new Event("processor_board_changed"));
    };
    // Lead changes come from the shared leads channel; technicians stay here.
    processorBoardLeadsRelease = subscribeToLeadChanges(dispatch);
    processorBoardChannel = supabase.channel(`processor-board:${generation}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "technicians" }, dispatch)
      .subscribe((status) => { if (status === "SUBSCRIBED") dispatch(); });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    realtimeBus.removeEventListener("processor_board_changed", onChange);
    if (--processorBoardConsumers === 0 && processorBoardChannel) {
      ++processorBoardGeneration;
      processorBoardLeadsRelease?.();
      processorBoardLeadsRelease = null;
      void supabase.removeChannel(processorBoardChannel);
      processorBoardChannel = null;
    }
  };
}

type ProcessorActivitySubscription = { channel: ReturnType<typeof supabase.channel>; consumers: number };
const processorActivitySubscriptions = new Map<string, ProcessorActivitySubscription>();
let processorActivityGeneration = 0;
/** Only the loaded page's saved conversation IDs; no global chat/message subscription. */
export function subscribeToProcessorActivity(conversationIds: string[], onChange: () => void) {
  const ids = [...new Set(conversationIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).sort();
  if (!ids.length) return () => {};
  const key = ids.join(",");
  const eventName = `processor_activity:${key}`;
  realtimeBus.addEventListener(eventName, onChange);
  let entry = processorActivitySubscriptions.get(key);
  if (!entry) {
    const channel = supabase.channel(`processor-activity:${++processorActivityGeneration}`);
    const created = { channel, consumers: 0 };
    processorActivitySubscriptions.set(key, created);
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "quo_conversations", filter: `id=in.(${key})` }, () => {
      if (processorActivitySubscriptions.get(key) === created) realtimeBus.dispatchEvent(new Event(eventName));
    }).subscribe((status) => {
      if (status === "SUBSCRIBED" && processorActivitySubscriptions.get(key) === created) realtimeBus.dispatchEvent(new Event(eventName));
    });
    entry = created;
  }
  entry.consumers++;
  const current = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    realtimeBus.removeEventListener(eventName, onChange);
    if (--current.consumers === 0) {
      processorActivitySubscriptions.delete(key);
      void supabase.removeChannel(current.channel);
    }
  };
}

export function setupGlobalRealtime() {
  if (isRealtimeSetup) return;
  isRealtimeSetup = true;

  // Single global channel for row-level components
  globalChannel = supabase
    .channel("global-app-events")
    // Load level from the database's governor (20261210010000_load_governor.sql):
    // a public broadcast on this same channel, so no extra channel or RLS check.
    .on("broadcast", { event: "system_load" }, (message: { payload?: { level?: unknown } }) => {
      setServerLoadLevel(message?.payload?.level);
    })
    // Table changes (lead notes, hold alerts, CX/Tech update requests) are no
    // longer subscribed here for every tab: screens that use them hold
    // relayTableToBus(table) while mounted, shared across tabs. Copy-permission
    // settings are read on focus and by a short poll (OperatorWorkflowSync).
    .subscribe((status, err) => {
      reportRealtimeStatus("global", status);
      if (status === 'SUBSCRIBED') {
        console.log("Global Realtime Channel Connected");
      }
      if (err) {
        console.error("Global Realtime Channel Error:", err);
      }
    });
}
