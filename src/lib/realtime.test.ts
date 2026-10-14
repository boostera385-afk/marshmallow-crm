import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToNotifications, type NotificationChange } from "./realtime";

const state = vi.hoisted(() => ({
  channels: [] as {
    name: string;
    handlers: { event: string; filter: string; callback: (payload: NotificationChange) => void }[];
  }[],
  remove: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: (name: string) => {
    const handlers: typeof state.channels[number]["handlers"] = [];
    const channel = {
      on: (_type: string, filter: { event: string; filter: string }, callback: (payload: NotificationChange) => void) => {
        handlers.push({ ...filter, callback });
        return channel;
      },
      subscribe: () => channel,
    };
    state.channels.push({ name, handlers });
    return channel;
  },
  removeChannel: state.remove,
} }));

const insert = { eventType: "INSERT", new: { title: "Urgent Job" } } as NotificationChange;
const releases: (() => void)[] = [];
function listen(user: string, handler: (payload: NotificationChange) => void) {
  const release = subscribeToNotifications(user, handler);
  releases.push(release);
  return release;
}
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  state.channels = [];
  state.remove.mockClear();
});

describe("recipient-scoped notification bus", () => {
  it("uses one channel for four consumers and delivers each INSERT/UPDATE once", () => {
    const listeners = Array.from({ length: 4 }, () => vi.fn());
    const cleanup = listeners.map((handler) => listen("synthetic-user", handler));
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].handlers.map(({ event, filter }) => ({ event, filter }))).toEqual([
      { event: "INSERT", filter: "user_id=eq.synthetic-user" },
      { event: "UPDATE", filter: "user_id=eq.synthetic-user" },
    ]);
    state.channels[0].handlers[0].callback(insert);
    const update = { ...insert, eventType: "UPDATE" } as NotificationChange;
    state.channels[0].handlers[1].callback(update);
    listeners.forEach((listener) => expect(listener.mock.calls).toEqual([[insert], [update]]));
    cleanup[0]();
    expect(state.remove).not.toHaveBeenCalled();
    state.channels[0].handlers[0].callback(insert);
    expect(listeners[0]).toHaveBeenCalledTimes(2);
    cleanup.slice(1).forEach((release) => release());
    expect(state.remove).toHaveBeenCalledTimes(1);
    cleanup.forEach((release) => release());
    expect(state.remove).toHaveBeenCalledTimes(1);
  });

  it("does not cross recipients and ignores late events from a retired channel", () => {
    const first = vi.fn();
    const second = vi.fn();
    const release = listen("user-a", first);
    listen("user-b", second);
    state.channels[0].handlers[0].callback(insert);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    release();
    const replacement = vi.fn();
    listen("user-a", replacement);
    expect(state.channels[2].name).not.toBe(state.channels[0].name);
    state.channels[0].handlers[0].callback(insert);
    expect(replacement).not.toHaveBeenCalled();
    state.channels[2].handlers[0].callback(insert);
    expect(replacement).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});
