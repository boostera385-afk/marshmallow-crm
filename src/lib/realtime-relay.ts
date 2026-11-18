import type { ChannelLike, LockManagerLike } from "@/lib/cross-tab";

/**
 * One realtime subscription per browser, not per tab.
 *
 * Every Postgres Changes binding a tab opens costs the Realtime service memory
 * and the database a per-subscriber check on each change. On the 2 GB host,
 * free memory tracked the number of open bindings (2026-11-17 probe: up to 162
 * during busy hours, about 13 per open tab). The same user with five CRM tabs
 * held five identical copies.
 *
 * For each key one tab (the leader) holds the real channel and relays its
 * changes and its subscribe status to the user's other tabs over a same-origin
 * BroadcastChannel; those tabs (followers) open nothing. Leadership is a Web
 * Lock that is never stolen, so switching tabs does not reopen channels; when
 * the leader closes, the next tab waiting for the lock takes over and opens the
 * channel. Its status goes CLOSED -> SUBSCRIBED in every tab, which the
 * realtime-health catch-up turns into one refresh for anything sent during the
 * hand-over. Without Web Locks or BroadcastChannel every tab leads (the old
 * per-tab behaviour).
 *
 * Keys must identify the subscription (table, event and filter, and the user
 * when the filter is user specific). Tabs of one browser share one sign-in, so
 * relayed rows are rows the receiving tab's user may already read.
 */

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";
export interface TableBinding {
  event: RealtimeEvent;
  table: string;
  filter?: string;
}

/** Opens the real channel; returns a close function. */
export type OpenChannel = (
  name: string,
  bindings: TableBinding[],
  onPayload: (bindingIndex: number, payload: unknown) => void,
  onStatus: (status: string) => void,
) => () => void;

export interface RelayOptions {
  locks: LockManagerLike | null;
  createChannel: ((name: string) => ChannelLike) | null;
  openChannel: OpenChannel;
  /** Health bookkeeping (realtime-health): status per health name, and forgetting it. */
  reportStatus: (healthName: string, status: string) => void;
  forgetStatus: (healthName: string) => void;
}

export interface RelaySubscription {
  key: string;
  bindings: TableBinding[];
  /** Name for realtime-health; one per subscription. */
  healthName: string;
}

type Listener = (payload: unknown, bindingIndex: number) => void;

type Message =
  | { type: "event"; key: string; index: number; payload: unknown }
  | { type: "status"; key: string; status: string }
  | { type: "hello"; key: string };

interface Entry {
  sub: RelaySubscription;
  listeners: Set<Listener>;
  leader: boolean;
  /** Set once this tab has heard a leader, so taking over counts as a reconnect. */
  sawLeader: boolean;
  status: string | null;
  generation: number;
  close?: () => void;
  releaseLock?: () => void;
  abort?: AbortController;
}

export const REALTIME_RELAY_CHANNEL = "marshmallow-realtime-relay";
const LOCK_PREFIX = "marshmallow-realtime:";

export function createRealtimeRelay(options: RelayOptions) {
  const channel = options.locks && options.createChannel ? options.createChannel(REALTIME_RELAY_CHANNEL) : null;
  const shared = Boolean(options.locks && channel);
  const entries = new Map<string, Entry>();
  let nextGeneration = 0;

  const post = (message: Message) => {
    try {
      channel?.postMessage(message);
    } catch (error) {
      console.warn("Realtime relay message failed", error);
    }
  };

  const dispatch = (entry: Entry, payload: unknown, index: number) => {
    entry.listeners.forEach((listener) => listener(payload, index));
  };

  const setStatus = (entry: Entry, status: string) => {
    entry.status = status;
    options.reportStatus(entry.sub.healthName, status);
  };

  const lead = (entry: Entry) => {
    const generation = ++nextGeneration;
    entry.generation = generation;
    entry.leader = true;
    // Taking over from another tab: changes during the hand-over may be lost, so
    // every tab (this one included) records a drop and catches up on SUBSCRIBED.
    if (entry.sawLeader) {
      setStatus(entry, "CLOSED");
      post({ type: "status", key: entry.sub.key, status: "CLOSED" });
    }
    const current = () => entry.generation === generation && entry.leader && entries.get(entry.sub.key) === entry;
    entry.close = options.openChannel(
      `${entry.sub.key}:${generation}`,
      entry.sub.bindings,
      (index, payload) => {
        if (!current()) return;
        dispatch(entry, payload, index);
        post({ type: "event", key: entry.sub.key, index, payload });
      },
      (status) => {
        if (!current()) return;
        setStatus(entry, status);
        post({ type: "status", key: entry.sub.key, status });
      },
    );
  };

  const requestLeadership = (entry: Entry) => {
    const abort = new AbortController();
    entry.abort = abort;
    options.locks!
      .request(`${LOCK_PREFIX}${entry.sub.key}`, { signal: abort.signal }, () => new Promise<void>((resolve) => {
        if (entries.get(entry.sub.key) !== entry) {
          resolve();
          return;
        }
        entry.releaseLock = resolve;
        lead(entry);
      }))
      .catch(() => { /* aborted while waiting: this tab stopped needing the key */ });
    // Ask a current leader for its status so this tab's health is known at once.
    post({ type: "hello", key: entry.sub.key });
  };

  const onMessage = (raw: unknown) => {
    const message = raw as Message;
    if (!message || typeof message !== "object" || typeof message.key !== "string") return;
    const entry = entries.get(message.key);
    if (!entry) return;
    if (message.type === "hello") {
      if (entry.leader && entry.status) post({ type: "status", key: entry.sub.key, status: entry.status });
      return;
    }
    if (entry.leader) return; // a stale leader's late message
    entry.sawLeader = true;
    if (message.type === "status") setStatus(entry, message.status);
    else if (message.type === "event") dispatch(entry, message.payload, message.index);
  };
  channel?.addEventListener("message", (event) => onMessage(event.data));

  const retire = (entry: Entry) => {
    entries.delete(entry.sub.key);
    entry.abort?.abort();
    if (entry.leader) {
      entry.leader = false;
      entry.close?.();
      // The next waiting tab opens the channel; tell the others it dropped meanwhile.
      post({ type: "status", key: entry.sub.key, status: "CLOSED" });
    }
    entry.releaseLock?.();
    options.forgetStatus(entry.sub.healthName);
  };

  /** Listen to `sub`; the first listener in this tab joins (or leads) it, the last one leaves. */
  const subscribe = (sub: RelaySubscription, listener: Listener) => {
    let entry = entries.get(sub.key);
    if (!entry) {
      entry = { sub, listeners: new Set(), leader: false, sawLeader: false, status: null, generation: 0 };
      entries.set(sub.key, entry);
      if (shared) requestLeadership(entry);
      else lead(entry);
    }
    // A wrapper keeps one function subscribed twice as two consumers.
    const wrapped: Listener = (payload, index) => listener(payload, index);
    entry.listeners.add(wrapped);
    const current = entry;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      current.listeners.delete(wrapped);
      if (current.listeners.size === 0 && entries.get(sub.key) === current) retire(current);
    };
  };

  return {
    shared,
    subscribe,
    /** Test/diagnostic: is this tab holding the real channel for `key`? */
    isLeader: (key: string) => entries.get(key)?.leader ?? false,
  };
}

export type RealtimeRelay = ReturnType<typeof createRealtimeRelay>;
