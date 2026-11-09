/**
 * One browser, one poller per data source.
 *
 * Every open CRM tab of the same signed-in user used to run its own timers, so
 * three tabs asked the database the same question three times. This coordinator
 * elects one owner tab per data key with the Web Locks API (the lock queue
 * hands ownership to the next tab automatically when the owner closes or
 * navigates away) and shares results over a same-origin BroadcastChannel:
 *
 * - Only the owner runs the polling timer for a key.
 * - A non-owner that needs fresh data (mount, focus, a realtime event, its own
 *   save) asks the owner, which reads once and broadcasts to every tab.
 * - The visible tab takes ownership, so the tab the user is looking at polls at
 *   full speed instead of a throttled background tab.
 * - If no owner answers quickly, the tab reads for itself. Browsers without
 *   Web Locks or BroadcastChannel keep the old per-tab behaviour.
 *
 * Keys must include the user (and any role/filter scope); results are only
 * shared between tabs of the same origin and never persisted.
 */

type LockCallback = (lock: unknown) => Promise<void>;
export interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal; steal?: boolean }, callback: LockCallback): Promise<unknown>;
  query(): Promise<unknown>;
}
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

type Message =
  | { type: "req"; key: string; id: string }
  | { type: "ack"; key: string; id: string }
  | { type: "res"; key: string; ok: true; data: unknown; at: number }
  | { type: "res"; key: string; ok: false; error: string; at: number };

interface Entry {
  key: string;
  refs: number;
  owner: boolean;
  token: object | null;
  abort?: AbortController;
  release?: () => void;
  listeners: Set<(owner: boolean) => void>;
  remoteRequest: Set<() => void>;
}

interface Waiter {
  id: string;
  acked: boolean;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

export interface CrossTabOptions {
  locks?: LockManagerLike | null;
  createChannel?: ((name: string) => ChannelLike) | null;
  isVisible?: () => boolean;
  onVisible?: (listener: () => void) => void;
  /** How long a non-owner waits for the owner to acknowledge before reading itself. */
  ackTimeoutMs?: number;
  /** How long a non-owner waits for an acknowledged read before reading itself. */
  resultTimeoutMs?: number;
  /** A shared result this recent answers another tab's request without a new read. */
  reuseMs?: number;
  now?: () => number;
}

export const CROSS_TAB_CHANNEL = "marshmallow-cross-tab";
const LOCK_PREFIX = "marshmallow-poll:";
let nextId = 0;

export function createCrossTabCoordinator(options: CrossTabOptions = {}) {
  const locks = options.locks ?? null;
  const channel = locks && options.createChannel ? options.createChannel(CROSS_TAB_CHANNEL) : null;
  const enabled = Boolean(locks && channel);
  const isVisible = options.isVisible ?? (() => true);
  const ackTimeoutMs = options.ackTimeoutMs ?? 1500;
  const resultTimeoutMs = options.resultTimeoutMs ?? 30000;
  const reuseMs = options.reuseMs ?? 1000;
  const now = options.now ?? Date.now;
  const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextId}`;

  const entries = new Map<string, Entry>();
  const waiters = new Map<string, Waiter[]>();
  const subscribers = new Map<string, Set<(data: unknown, at: number) => void>>();
  const anySubscribers = new Set<(key: string, data: unknown, at: number) => void>();
  // Reads in flight and the last shared result, so other tabs' requests (usually the
  // same realtime event this tab also received) join them instead of reading again.
  const inFlight = new Map<string, Promise<unknown>>();
  const lastShared = new Map<string, { data: unknown; at: number }>();

  const post = (message: Message) => {
    try {
      channel?.postMessage(message);
    } catch (error) {
      // Uncloneable data: other tabs time out and read for themselves.
      console.warn("Cross-tab share failed", error);
    }
  };

  const setOwner = (entry: Entry, owner: boolean) => {
    if (entry.owner === owner) return;
    entry.owner = owner;
    entry.listeners.forEach((listener) => listener(owner));
  };

  const acquire = (entry: Entry, steal: boolean) => {
    if (!locks) return;
    const token = {};
    entry.token = token;
    entry.abort?.abort();
    const abort = steal ? undefined : new AbortController();
    entry.abort = abort;
    // Granted: hold the lock until this tab releases the key (or it is stolen).
    const hold = () => new Promise<void>((resolve) => {
      if (entry.token !== token || entry.refs === 0) {
        resolve();
        return;
      }
      entry.release = resolve;
      setOwner(entry, true);
    });
    locks
      .request(`${LOCK_PREFIX}${entry.key}`, steal ? { steal: true } : { signal: abort?.signal }, hold)
      .catch(() => {
        // Aborted by us (token replaced) or stolen by a tab the user just looked at.
        if (entry.token !== token) return;
        entry.release = undefined;
        setOwner(entry, false);
        if (entry.refs > 0) acquire(entry, false);
      });
  };

  /** Register interest in a key; the returned handle reports ownership. */
  const claim = (key: string, onRemoteRequest?: () => void) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, refs: 0, owner: !enabled, token: null, listeners: new Set(), remoteRequest: new Set() };
      entries.set(key, entry);
    }
    entry.refs += 1;
    if (onRemoteRequest) entry.remoteRequest.add(onRemoteRequest);
    if (enabled && entry.refs === 1) acquire(entry, isVisible());
    const current = entry;
    let released = false;
    return {
      isOwner: () => current.owner,
      onChange: (listener: (owner: boolean) => void) => {
        current.listeners.add(listener);
        return () => current.listeners.delete(listener);
      },
      release: () => {
        if (released) return;
        released = true;
        if (onRemoteRequest) current.remoteRequest.delete(onRemoteRequest);
        current.refs -= 1;
        if (current.refs > 0) return;
        entries.delete(key);
        lastShared.delete(key);
        current.token = null;
        current.abort?.abort();
        current.release?.();
        current.release = undefined;
        setOwner(current, false);
      },
    };
  };

  const broadcast = (key: string, result: { ok: true; data: unknown } | { ok: false; error: string }) => {
    if (!enabled) return;
    const at = now();
    if ("data" in result && entries.has(key)) lastShared.set(key, { data: result.data, at });
    else lastShared.delete(key);
    post({ type: "res", key, at, ...result } as Message);
  };

  const readAndShare = async <T,>(key: string, read: () => Promise<T>): Promise<T> => {
    const run = (async () => {
      try {
        const data = await read();
        broadcast(key, { ok: true, data });
        return data;
      } catch (error) {
        broadcast(key, { ok: false, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    })();
    if (enabled) {
      inFlight.set(key, run);
      const clear = () => { if (inFlight.get(key) === run) inFlight.delete(key); };
      run.then(clear, clear);
    }
    return run;
  };

  const askOwner = (key: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `${tabId}:${++nextId}`;
      const list = waiters.get(key) ?? [];
      let settled = false;
      const done = () => {
        settled = true;
        const remaining = (waiters.get(key) ?? []).filter((waiter) => waiter.id !== id);
        if (remaining.length) waiters.set(key, remaining);
        else waiters.delete(key);
      };
      const waiter: Waiter = {
        id,
        acked: false,
        resolve: (data) => { if (!settled) { done(); resolve(data); } },
        reject: (error) => { if (!settled) { done(); reject(error); } },
      };
      waiters.set(key, [...list, waiter]);
      post({ type: "req", key, id });
      setTimeout(() => {
        if (settled || waiter.acked) return;
        done();
        reject(new NoOwnerError());
      }, ackTimeoutMs);
      setTimeout(() => {
        if (settled) return;
        done();
        reject(new NoOwnerError());
      }, resultTimeoutMs);
    });

  /**
   * Read through the owner. The owner (or a tab with no coordination) reads and
   * shares; any other tab asks the owner and only reads itself if nobody answers.
   */
  const fetch = async <T,>(key: string, read: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    if (!enabled || !entry || entry.owner) return readAndShare(key, read);
    try {
      return (await askOwner(key)) as T;
    } catch (error) {
      if (!(error instanceof NoOwnerError)) throw error;
      return readAndShare(key, read);
    }
  };

  const subscribe = (key: string, listener: (data: unknown, at: number) => void) => {
    const set = subscribers.get(key) ?? new Set();
    set.add(listener);
    subscribers.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) subscribers.delete(key);
    };
  };

  const subscribeAll = (listener: (key: string, data: unknown, at: number) => void) => {
    anySubscribers.add(listener);
    return () => { anySubscribers.delete(listener); };
  };

  const onMessage = (raw: unknown) => {
    const message = raw as Message;
    if (!message || typeof message !== "object" || typeof message.key !== "string") return;
    const entry = entries.get(message.key);
    if (message.type === "req") {
      if (!entry?.owner) return;
      post({ type: "ack", key: message.key, id: message.id });
      if (inFlight.has(message.key)) return; // its result is broadcast when it lands
      const recent = lastShared.get(message.key);
      if (recent && now() - recent.at < reuseMs) {
        post({ type: "res", key: message.key, ok: true, data: recent.data, at: recent.at });
        return;
      }
      entry.remoteRequest.forEach((request) => request());
      return;
    }
    if (message.type === "ack") {
      (waiters.get(message.key) ?? []).forEach((waiter) => { if (waiter.id === message.id) waiter.acked = true; });
      return;
    }
    if (message.type !== "res") return;
    const pending = waiters.get(message.key) ?? [];
    if (pending.length) {
      // The callers that asked apply the result themselves.
      const result = message;
      pending.forEach((waiter) => {
        if ("error" in result) waiter.reject(new Error(result.error));
        else waiter.resolve(result.data);
      });
      return;
    }
    if (!message.ok || !entry || entry.owner) return;
    subscribers.get(message.key)?.forEach((listener) => listener(message.data, message.at));
    anySubscribers.forEach((listener) => listener(message.key, message.data, message.at));
  };

  channel?.addEventListener("message", (event) => onMessage(event.data));

  // The tab the user is looking at takes over polling from a background tab.
  options.onVisible?.(() => {
    if (!enabled) return;
    entries.forEach((entry) => {
      if (entry.refs > 0 && !entry.owner) acquire(entry, true);
    });
  });

  return { enabled, claim, fetch, subscribe, subscribeAll, isOwner: (key: string) => entries.get(key)?.owner ?? !enabled };
}

export class NoOwnerError extends Error {
  constructor() {
    super("No owner tab answered");
    this.name = "NoOwnerError";
  }
}

export type CrossTabCoordinator = ReturnType<typeof createCrossTabCoordinator>;

function browserLocks(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: Partial<LockManagerLike> }).locks;
  // Require the full API; partial stand-ins keep the per-tab behaviour.
  return locks && typeof locks.request === "function" && typeof locks.query === "function" ? (locks as LockManagerLike) : null;
}

function createBrowserCoordinator() {
  const hasDocument = typeof document !== "undefined";
  return createCrossTabCoordinator({
    locks: browserLocks(),
    createChannel: typeof BroadcastChannel === "function" ? (name) => new BroadcastChannel(name) as unknown as ChannelLike : null,
    isVisible: () => !hasDocument || document.visibilityState === "visible",
    onVisible: (listener) => {
      if (!hasDocument) return;
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") listener(); });
    },
  });
}

let browserCoordinator: CrossTabCoordinator | null = null;
/** The shared coordinator for this tab (created lazily so tests can replace it). */
export function crossTab(): CrossTabCoordinator {
  browserCoordinator ??= createBrowserCoordinator();
  return browserCoordinator;
}
/** Test hook: install a coordinator (or reset to the browser one with null). */
export function setCrossTabCoordinator(next: CrossTabCoordinator | null) {
  browserCoordinator = next;
}
