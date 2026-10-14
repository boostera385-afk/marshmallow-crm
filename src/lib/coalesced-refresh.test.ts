import { describe, expect, it, vi } from "vitest";
import { createCoalescedRefresh } from "./coalesced-refresh";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("coalesced refresh", () => {
  it("merges same-turn requests without waiting for a timer", async () => {
    const read = vi.fn(async () => {});
    const queue = createCoalescedRefresh(read, vi.fn());
    const requests = Array.from({ length: 50 }, () => queue.request());
    await Promise.all(requests);
    expect(read).toHaveBeenCalledTimes(1);
    await queue.request();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("serializes in-flight events into one trailing read with the latest data", async () => {
    const first = deferred();
    let stored = "before";
    const committed: string[] = [];
    const read = vi.fn(async () => {
      const snapshot = stored;
      if (read.mock.calls.length === 1) await first.promise;
      committed.push(snapshot);
    });
    const queue = createCoalescedRefresh(read, vi.fn());
    const completion = queue.request();
    await Promise.resolve();
    stored = "after";
    for (let i = 0; i < 50; i++) void queue.request();
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve();
    await completion;
    expect(read).toHaveBeenCalledTimes(2);
    expect(committed).toEqual(["before", "after"]);
  });

  it("does not lose an event arriving during the trailing read", async () => {
    const first = deferred();
    const second = deferred();
    const read = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValue(undefined);
    const queue = createCoalescedRefresh(read, vi.fn());
    const completion = queue.request();
    await Promise.resolve();
    void queue.request();
    first.resolve();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    void queue.request();
    second.resolve();
    await completion;
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("recovers after failure, including an already queued event", async () => {
    const first = deferred();
    const onError = vi.fn();
    const read = vi.fn()
      .mockImplementationOnce(async () => { await first.promise; throw new Error("Offline"); })
      .mockResolvedValue(undefined);
    const queue = createCoalescedRefresh(read, onError);
    const completion = queue.request();
    await Promise.resolve();
    void queue.request();
    first.resolve();
    await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    await queue.request();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("retires stale results and queued work on disposal", async () => {
    const first = deferred();
    const commit = vi.fn();
    const read = vi.fn(async (isCurrent: () => boolean) => {
      await first.promise;
      if (isCurrent()) commit();
    });
    const queue = createCoalescedRefresh(read, vi.fn());
    const completion = queue.request();
    await Promise.resolve();
    void queue.request();
    queue.dispose();
    first.resolve();
    await completion;
    await queue.request();
    expect(commit).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
