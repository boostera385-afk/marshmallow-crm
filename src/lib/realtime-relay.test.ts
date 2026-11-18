import { describe, expect, it, vi } from "vitest";
import { createRealtimeRelay, type OpenChannel, type RelaySubscription } from "@/lib/realtime-relay";
import { FakeChannelHub, FakeLocks, flush } from "@/test/cross-tab-fakes";

/** A real channel opened by a leader tab; the test pushes payloads and statuses into it. */
interface OpenedChannel {
  name: string;
  closed: boolean;
  push: (index: number, payload: unknown) => void;
  status: (status: string) => void;
}

function browser() {
  return { locks: new FakeLocks(), hub: new FakeChannelHub(), opened: [] as OpenedChannel[] };
}

function tab(env: ReturnType<typeof browser>, shared = true) {
  const statuses: [string, string][] = [];
  const forgotten: string[] = [];
  const openChannel: OpenChannel = (name, _bindings, onPayload, onStatus) => {
    const channel: OpenedChannel = { name, closed: false, push: onPayload, status: onStatus };
    env.opened.push(channel);
    return () => { channel.closed = true; };
  };
  const relay = createRealtimeRelay({
    locks: shared ? env.locks : null,
    createChannel: shared ? (name) => env.hub.create(name) : null,
    openChannel,
    reportStatus: (name, status) => statuses.push([name, status]),
    forgetStatus: (name) => forgotten.push(name),
  });
  return { relay, statuses, forgotten };
}

const LEADS: RelaySubscription = { key: "leads:all", healthName: "leads", bindings: [{ event: "*", table: "leads" }] };
const open = (env: ReturnType<typeof browser>) => env.opened.filter((channel) => !channel.closed);

describe("one realtime subscription per browser", () => {
  it("opens one channel for all tabs and relays every change to each tab once", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    const c = tab(env);
    const seenA = vi.fn();
    const seenB = vi.fn();
    const seenC = vi.fn();
    a.relay.subscribe(LEADS, seenA);
    b.relay.subscribe(LEADS, seenB);
    c.relay.subscribe(LEADS, seenC);
    await flush();

    expect(open(env)).toHaveLength(1);
    expect([a.relay.isLeader(LEADS.key), b.relay.isLeader(LEADS.key), c.relay.isLeader(LEADS.key)]).toEqual([true, false, false]);

    open(env)[0].push(0, { eventType: "UPDATE", new: { id: "lead-1" } });
    await flush();
    for (const seen of [seenA, seenB, seenC]) {
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledWith({ eventType: "UPDATE", new: { id: "lead-1" } }, 0);
    }
  });

  it("shares the leader's subscribe status, including with a tab that joins later", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    a.relay.subscribe(LEADS, () => {});
    b.relay.subscribe(LEADS, () => {});
    await flush();
    open(env)[0].status("SUBSCRIBED");
    await flush();
    expect(a.statuses).toEqual([["leads", "SUBSCRIBED"]]);
    expect(b.statuses).toEqual([["leads", "SUBSCRIBED"]]);

    const late = tab(env);
    late.relay.subscribe(LEADS, () => {});
    await flush();
    expect(late.statuses).toEqual([["leads", "SUBSCRIBED"]]);
    expect(open(env)).toHaveLength(1);
  });

  it("hands the channel to the next tab when the leader closes, and every tab sees a drop then recovery", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    const c = tab(env);
    const releaseA = a.relay.subscribe(LEADS, () => {});
    const seenB = vi.fn();
    const seenC = vi.fn();
    b.relay.subscribe(LEADS, seenB);
    c.relay.subscribe(LEADS, seenC);
    await flush();
    open(env)[0].status("SUBSCRIBED");
    await flush();

    releaseA();
    await flush();
    expect(env.opened[0].closed).toBe(true);
    expect(open(env)).toHaveLength(1);
    expect(b.relay.isLeader(LEADS.key)).toBe(true);
    expect(a.forgotten).toEqual(["leads"]);

    open(env)[0].status("SUBSCRIBED");
    await flush();
    // CLOSED before SUBSCRIBED is what makes realtime-health run its catch-up read.
    for (const t of [b, c]) {
      const after = t.statuses.slice(1).map(([, status]) => status);
      expect(after).toContain("CLOSED");
      expect(after.lastIndexOf("SUBSCRIBED")).toBeGreaterThan(after.indexOf("CLOSED"));
    }

    open(env)[0].push(0, { id: "after-handover" });
    await flush();
    expect(seenB).toHaveBeenCalledWith({ id: "after-handover" }, 0);
    expect(seenC).toHaveBeenCalledWith({ id: "after-handover" }, 0);
  });

  it("keeps different subscriptions (tables, users) independent", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    const forUser = (user: string): RelaySubscription => ({
      key: `notifications:${user}`,
      healthName: "notifications",
      bindings: [{ event: "INSERT", table: "notifications", filter: `user_id=eq.${user}` }],
    });
    const seenA = vi.fn();
    const seenB = vi.fn();
    a.relay.subscribe(forUser("user-1"), seenA);
    b.relay.subscribe(forUser("user-2"), seenB);
    await flush();
    expect(open(env).map((channel) => channel.name.split(":").slice(0, 2).join(":"))).toEqual(["notifications:user-1", "notifications:user-2"]);

    open(env)[0].push(0, { id: "for-user-1" });
    await flush();
    expect(seenA).toHaveBeenCalledTimes(1);
    expect(seenB).not.toHaveBeenCalled();
  });

  it("shares one channel between consumers in a tab and closes it with the last one", async () => {
    const env = browser();
    const a = tab(env);
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = a.relay.subscribe(LEADS, first);
    const releaseSecond = a.relay.subscribe(LEADS, second);
    await flush();
    expect(env.opened).toHaveLength(1);

    releaseFirst();
    releaseFirst();
    env.opened[0].push(0, { id: "x" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(env.opened[0].closed).toBe(false);

    releaseSecond();
    expect(env.opened[0].closed).toBe(true);
    expect(a.forgotten).toEqual(["leads"]);
  });

  it("ignores a closed channel's late events and a stale leader's messages", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    const releaseA = a.relay.subscribe(LEADS, () => {});
    const seenB = vi.fn();
    b.relay.subscribe(LEADS, seenB);
    await flush();
    const retired = env.opened[0];
    releaseA();
    await flush();
    retired.push(0, { id: "late" });
    await flush();
    expect(seenB).not.toHaveBeenCalled();
  });

  it("keeps the old per-tab behaviour without Web Locks or BroadcastChannel", async () => {
    const env = browser();
    const a = tab(env, false);
    const b = tab(env, false);
    const seenA = vi.fn();
    a.relay.subscribe(LEADS, seenA);
    b.relay.subscribe(LEADS, () => {});
    await flush();
    expect(env.opened).toHaveLength(2);
    expect([a.relay.isLeader(LEADS.key), b.relay.isLeader(LEADS.key)]).toEqual([true, true]);
    env.opened[0].push(0, { id: "own" });
    expect(seenA).toHaveBeenCalledWith({ id: "own" }, 0);
  });

  it("opens nothing for a tab that stops listening before it was ever the leader", async () => {
    const env = browser();
    const a = tab(env);
    const b = tab(env);
    a.relay.subscribe(LEADS, () => {});
    const releaseB = b.relay.subscribe(LEADS, () => {});
    await flush();
    releaseB();
    await flush();
    expect(env.opened).toHaveLength(1);
    expect(b.forgotten).toEqual(["leads"]);
  });
});
