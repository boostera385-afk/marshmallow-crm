import { createCrossTabCoordinator, type ChannelLike, type LockManagerLike } from "@/lib/cross-tab";

const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

interface LockRequest {
  callback: (lock: unknown) => Promise<void>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  held: boolean;
}

/** One browser's Web Locks: exclusive, FIFO, abortable while queued, stealable. */
export class FakeLocks implements LockManagerLike {
  private queues = new Map<string, LockRequest[]>();

  request(name: string, options: { signal?: AbortSignal; steal?: boolean }, callback: (lock: unknown) => Promise<void>) {
    return new Promise<unknown>((resolve, reject) => {
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      const request: LockRequest = { callback, resolve, reject, held: false };
      if (options.steal) {
        const holder = queue.find((entry) => entry.held);
        if (holder) {
          queue.splice(queue.indexOf(holder), 1);
          holder.held = false;
          holder.reject(abortError());
        }
        queue.unshift(request);
        this.grant(name, request);
        return;
      }
      if (options.signal?.aborted) {
        reject(abortError());
        return;
      }
      options.signal?.addEventListener("abort", () => {
        if (request.held || !queue.includes(request)) return;
        queue.splice(queue.indexOf(request), 1);
        reject(abortError());
      });
      queue.push(request);
      this.pump(name);
    });
  }

  query() {
    return Promise.resolve({ held: [...this.queues.entries()].filter(([, q]) => q.some((r) => r.held)).map(([name]) => name) });
  }

  private grant(name: string, request: LockRequest) {
    request.held = true;
    void Promise.resolve(request.callback({ name })).then((value) => {
      const queue = this.queues.get(name) ?? [];
      if (!request.held) return; // stolen: the thief already holds it
      request.held = false;
      queue.splice(queue.indexOf(request), 1);
      request.resolve(value);
      this.pump(name);
    });
  }

  private pump(name: string) {
    const queue = this.queues.get(name) ?? [];
    if (queue.some((entry) => entry.held) || !queue.length) return;
    this.grant(name, queue[0]);
  }
}

/** Same-origin BroadcastChannel: async, structured-cloned, never echoed to the sender. */
export class FakeChannelHub {
  private channels = new Set<FakeChannel>();
  sent: unknown[] = [];
  create(name: string): ChannelLike {
    const channel = new FakeChannel(name, this);
    this.channels.add(channel);
    return channel;
  }
  deliver(from: FakeChannel, message: unknown) {
    this.sent.push(message);
    const copy = structuredClone(message);
    this.channels.forEach((channel) => {
      if (channel !== from && channel.name === from.name && !channel.closed) setTimeout(() => channel.emit(copy), 0);
    });
  }
}

class FakeChannel implements ChannelLike {
  closed = false;
  private listeners = new Set<(event: { data: unknown }) => void>();
  constructor(readonly name: string, private hub: FakeChannelHub) {}
  postMessage(message: unknown) { this.hub.deliver(this, message); }
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void) { this.listeners.add(listener); }
  close() { this.closed = true; }
  emit(data: unknown) { this.listeners.forEach((listener) => listener({ data })); }
}

/** A simulated tab sharing one browser's locks and channel hub. */
export function createFakeTab(locks: FakeLocks, hub: FakeChannelHub, visible = false, timeouts = { ackTimeoutMs: 40, resultTimeoutMs: 400 }) {
  let isVisible = visible;
  let onVisible: (() => void) | null = null;
  const coordinator = createCrossTabCoordinator({
    locks,
    createChannel: (name) => hub.create(name),
    isVisible: () => isVisible,
    onVisible: (listener) => { onVisible = listener; },
    ...timeouts,
  });
  return {
    coordinator,
    show() { isVisible = true; onVisible?.(); },
    hide() { isVisible = false; },
  };
}

export const flush = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
