import { describe, expect, it, vi } from "vitest";
import { createCrossTabCoordinator } from "@/lib/cross-tab";
import { createFakeTab, FakeChannelHub, FakeLocks, flush } from "@/test/cross-tab-fakes";

const KEY = "notifications:urgent:user-1";

function browser() {
  return { locks: new FakeLocks(), hub: new FakeChannelHub() };
}

describe("cross-tab polling coordinator", () => {
  it("lets exactly one tab of a browser own a key and hands it over when that tab leaves", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    const handleA = a.coordinator.claim(KEY);
    const handleB = b.coordinator.claim(KEY);
    await flush();
    expect([handleA.isOwner(), handleB.isOwner()]).toEqual([true, false]);

    handleA.release();
    await flush();
    expect(handleB.isOwner()).toBe(true);
  });

  it("keeps different keys (users, scopes) independent", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    const first = a.coordinator.claim("bell:user-1");
    const second = b.coordinator.claim("bell:user-2");
    await flush();
    expect([first.isOwner(), second.isOwner()]).toEqual([true, true]);
  });

  it("serves a non-owner's read through the owner: one database read for both tabs", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    const ownerRead = vi.fn(async () => ({ rows: ["n1"], unread: 1 }));
    const followerRead = vi.fn(async () => ({ rows: ["local"], unread: 0 }));
    a.coordinator.claim(KEY, () => { void a.coordinator.fetch(KEY, ownerRead); });
    b.coordinator.claim(KEY);
    await flush();

    await expect(b.coordinator.fetch(KEY, followerRead)).resolves.toEqual({ rows: ["n1"], unread: 1 });
    expect(ownerRead).toHaveBeenCalledTimes(1);
    expect(followerRead).not.toHaveBeenCalled();
  });

  it("delivers the owner's timer results to other tabs without them reading", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    a.coordinator.claim(KEY);
    b.coordinator.claim(KEY);
    await flush();
    const received = vi.fn();
    const ownerEcho = vi.fn();
    b.coordinator.subscribe(KEY, received);
    a.coordinator.subscribe(KEY, ownerEcho);

    await a.coordinator.fetch(KEY, async () => [1, 2, 3]);
    await flush();
    expect(received).toHaveBeenCalledWith([1, 2, 3], expect.any(Number));
    expect(ownerEcho).not.toHaveBeenCalled();
  });

  it("ignores shared results for keys this tab does not use", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    a.coordinator.claim(KEY);
    await flush();
    const received = vi.fn();
    b.coordinator.subscribeAll(received);
    await a.coordinator.fetch(KEY, async () => "data");
    await flush();
    expect(received).not.toHaveBeenCalled();
  });

  it("moves ownership to the tab the user looks at, and back when it closes", async () => {
    const { locks, hub } = browser();
    const background = createFakeTab(locks, hub, false);
    const foreground = createFakeTab(locks, hub, false);
    const bg = background.coordinator.claim(KEY);
    const fg = foreground.coordinator.claim(KEY);
    await flush();
    expect([bg.isOwner(), fg.isOwner()]).toEqual([true, false]);

    foreground.show();
    await flush();
    expect([bg.isOwner(), fg.isOwner()]).toEqual([false, true]);

    fg.release();
    await flush();
    expect(bg.isOwner()).toBe(true);
  });

  it("a visible tab opening a key takes it over immediately", async () => {
    const { locks, hub } = browser();
    const hidden = createFakeTab(locks, hub, false);
    const visible = createFakeTab(locks, hub, true);
    const h = hidden.coordinator.claim(KEY);
    await flush();
    const v = visible.coordinator.claim(KEY);
    await flush();
    expect([h.isOwner(), v.isOwner()]).toEqual([false, true]);
  });

  it("falls back to reading itself when no owner answers", async () => {
    const { locks, hub } = browser();
    // Tab A holds the lock but is frozen: its channel receives nothing.
    const frozen = createCrossTabCoordinator({
      locks,
      createChannel: (name) => { const channel = hub.create(name); channel.close(); return channel; },
      ackTimeoutMs: 40,
    });
    const b = createFakeTab(locks, hub);
    frozen.claim(KEY, () => { throw new Error("must not be asked"); });
    b.coordinator.claim(KEY);
    await flush();
    const read = vi.fn(async () => "own read");

    await expect(b.coordinator.fetch(KEY, read)).resolves.toBe("own read");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reports the owner's read failure instead of hammering the database again", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    a.coordinator.claim(KEY, () => {
      void a.coordinator.fetch(KEY, async () => { throw new Error("statement timeout"); }).catch(() => undefined);
    });
    b.coordinator.claim(KEY);
    await flush();
    const followerRead = vi.fn(async () => "duplicate");

    await expect(b.coordinator.fetch(KEY, followerRead)).rejects.toThrow("statement timeout");
    expect(followerRead).not.toHaveBeenCalled();
  });

  it("joins another tab's request to a read already in flight instead of reading twice", async () => {
    const { locks, hub } = browser();
    const a = createFakeTab(locks, hub);
    const b = createFakeTab(locks, hub);
    let finish!: (value: string) => void;
    const ownerRead = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const remote = vi.fn();
    a.coordinator.claim(KEY, remote);
    b.coordinator.claim(KEY);
    await flush();

    const ownerReading = a.coordinator.fetch(KEY, ownerRead);
    const followerReading = b.coordinator.fetch(KEY, vi.fn(async () => "duplicate"));
    await flush();
    finish("fresh");
    await expect(ownerReading).resolves.toBe("fresh");
    await expect(followerReading).resolves.toBe("fresh");
    expect(ownerRead).toHaveBeenCalledTimes(1);
    expect(remote).not.toHaveBeenCalled();

    // A request right after a shared result reuses it; later ones ask for a new read.
    await expect(b.coordinator.fetch(KEY, vi.fn(async () => "duplicate"))).resolves.toBe("fresh");
    expect(remote).not.toHaveBeenCalled();
  });

  it("keeps the old per-tab behaviour without Web Locks", async () => {
    const createChannel = vi.fn();
    const coordinator = createCrossTabCoordinator({ locks: null, createChannel });
    const handle = coordinator.claim(KEY);
    expect(coordinator.enabled).toBe(false);
    expect(handle.isOwner()).toBe(true);
    expect(createChannel).not.toHaveBeenCalled();
    await expect(coordinator.fetch(KEY, async () => "direct")).resolves.toBe("direct");
  });
});
