import { afterEach, describe, expect, it, vi } from "vitest";
import { setupGlobalRealtime, subscribeToLeadChanges, subscribeToNotifications, subscribeToProcessorActivity, subscribeToProcessorBoard, type LeadChange, type NotificationChange } from "./realtime";
import { getServerLoadLevel, isBackgroundPollPaused, resetOverloadGuard } from "./overload-guard";

const state = vi.hoisted(() => ({
  channels: [] as {
    name: string;
    handlers: { event: string; filter: string; table: string; callback: (payload: NotificationChange) => void }[];
  }[],
  remove: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: (name: string) => {
    const handlers: typeof state.channels[number]["handlers"] = [];
    const channel = {
      on: (_type: string, filter: { event: string; filter: string; table: string }, callback: (payload: NotificationChange) => void) => {
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

describe("mounted Processor Board transport", () => {
  it("shares one technicians channel plus the tab's leads channel, cleans up on last consumer and ignores retired events", () => {
    const first = vi.fn(); const second = vi.fn();
    const releaseA = subscribeToProcessorBoard(first);
    const releaseB = subscribeToProcessorBoard(second);
    releases.push(releaseA, releaseB);
    // One shared leads channel and one technicians channel, however many consumers.
    expect(state.channels.map((c) => c.handlers.map((h) => h.table))).toEqual([["leads"], ["technicians"]]);
    const [retiredLeads, retiredTechs] = state.channels;
    retiredLeads.handlers[0].callback(insert);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    retiredTechs.handlers[0].callback(insert);
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
    releaseA(); expect(state.remove).not.toHaveBeenCalled();
    releaseB(); releaseB(); expect(state.remove).toHaveBeenCalledTimes(2);
    const replacement = vi.fn(); releases.push(subscribeToProcessorBoard(replacement));
    retiredLeads.handlers[0].callback(insert); retiredTechs.handlers[0].callback(insert);
    expect(replacement).not.toHaveBeenCalled();
    state.channels[2].handlers[0].callback(insert); expect(replacement).toHaveBeenCalledOnce();
  });
  it("shares a filtered saved-conversation channel and retires callbacks on page changes", () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    const first = vi.fn(); const second = vi.fn();
    const releaseA = subscribeToProcessorActivity([b, a, a], first);
    const releaseB = subscribeToProcessorActivity([a, b], second);
    releases.push(releaseA, releaseB);
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].handlers[0].filter).toBe(`id=in.(${a},${b})`);
    state.channels[0].handlers[0].callback(insert);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    releaseA(); expect(state.remove).not.toHaveBeenCalled();
    releaseB(); expect(state.remove).toHaveBeenCalledOnce();
    const replacement = vi.fn(); releases.push(subscribeToProcessorActivity([a], replacement));
    state.channels[0].handlers[0].callback(insert);
    expect(replacement).not.toHaveBeenCalled();
    state.channels[1].handlers[0].callback(insert); expect(replacement).toHaveBeenCalledOnce();
  });
  it("does not open an unfiltered chat subscription for an empty/invalid page", () => {
    const release = subscribeToProcessorActivity(["not-a-saved-uuid"], vi.fn()); releases.push(release);
    expect(state.channels).toHaveLength(0);
  });
});

describe("shared leads channel", () => {
  const change = { eventType: "UPDATE", new: { id: "lead-1", status: "quoted" }, old: { id: "lead-1" } } as unknown as LeadChange;

  it("opens one unfiltered leads channel for every consumer in the tab and delivers each change once to each", () => {
    const leadsPage = vi.fn(); const map = vi.fn(); const schedule = vi.fn();
    releases.push(subscribeToLeadChanges(leadsPage), subscribeToLeadChanges(map), subscribeToLeadChanges(schedule));
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].handlers).toEqual([expect.objectContaining({ event: "*", table: "leads" })]);
    state.channels[0].handlers[0].callback(change as unknown as NotificationChange);
    for (const consumer of [leadsPage, map, schedule]) {
      expect(consumer).toHaveBeenCalledOnce();
      expect(consumer).toHaveBeenCalledWith(change);
    }
  });

  it("is shared with the Processor Board instead of opening a second leads channel", () => {
    const page = vi.fn(); const board = vi.fn();
    releases.push(subscribeToLeadChanges(page), subscribeToProcessorBoard(board));
    expect(state.channels.filter((c) => c.handlers.some((h) => h.table === "leads"))).toHaveLength(1);
    state.channels[0].handlers[0].callback(change as unknown as NotificationChange);
    expect(page).toHaveBeenCalledOnce(); expect(board).toHaveBeenCalledOnce();
  });

  it("closes the channel only after the last consumer leaves, and ignores a retired channel's late events", () => {
    const first = vi.fn(); const second = vi.fn();
    const releaseFirst = subscribeToLeadChanges(first);
    const releaseSecond = subscribeToLeadChanges(second);
    releaseFirst(); releaseFirst();
    expect(state.remove).not.toHaveBeenCalled();
    const retired = state.channels[0];
    retired.handlers[0].callback(change as unknown as NotificationChange);
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    releaseSecond();
    expect(state.remove).toHaveBeenCalledOnce();

    const replacement = vi.fn(); releases.push(subscribeToLeadChanges(replacement));
    expect(state.channels).toHaveLength(2);
    retired.handlers[0].callback(change as unknown as NotificationChange);
    expect(replacement).not.toHaveBeenCalled();
    state.channels[1].handlers[0].callback(change as unknown as NotificationChange);
    expect(replacement).toHaveBeenCalledOnce();
  });
});

describe("server load level broadcast", () => {
  afterEach(resetOverloadGuard);

  it("listens on the existing global channel and pauses background polling when the server says critical", () => {
    setupGlobalRealtime();
    const global = state.channels.find((channel) => channel.name === "global-app-events")!;
    const broadcast = global.handlers.find((handler) => handler.event === "system_load")!;
    expect(broadcast).toBeDefined();
    expect(state.channels.filter((channel) => channel.name === "global-app-events")).toHaveLength(1);
    (broadcast.callback as unknown as (message: unknown) => void)({ event: "system_load", payload: { level: "critical", busy_pct: 91 } });
    expect(getServerLoadLevel()).toBe("critical");
    expect(isBackgroundPollPaused()).toBe(true);
  });
});
