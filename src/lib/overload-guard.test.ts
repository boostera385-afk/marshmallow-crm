import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OVERLOAD_BASE_COOLDOWN_MS,
  OVERLOAD_INCIDENT_GAP_MS,
  OVERLOAD_MAX_COOLDOWN_MS,
  OVERLOAD_RESUME_JITTER_MS,
  OVERLOAD_TRIP_COUNT,
  OVERLOAD_WINDOW_MS,
  SERVER_LEVEL_STEP_DOWN_JITTER_MS,
  SERVER_LEVEL_TTL_MS,
  backgroundDelay,
  getServerLoadLevel,
  installOverloadGuard,
  isServerLoadRaised,
  setServerLoadLevel,
  isBackgroundPollPaused,
  msUntilBackgroundResume,
  recordOverloadResponse,
  resetOverloadGuard,
  subscribeOverload,
} from "./overload-guard";

const API = "https://kxiqholnmhkwhdkhtopp.supabase.co";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T14:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Math, "random").mockReturnValue(0); // no resume spread: exact timings
});
afterEach(() => { resetOverloadGuard(); vi.useRealTimers(); vi.restoreAllMocks(); });

/** A fake global with a scripted fetch, wrapped by the guard. */
function guarded(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string }[] = [];
  const target = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      return respond(url, init);
    }) as typeof fetch,
  };
  installOverloadGuard(target);
  return { target, calls };
}
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

describe("detecting an overload", () => {
  it("pauses background polling after repeated gateway timeouts from the Supabase APIs", async () => {
    const { target } = guarded(() => json(504, { message: "timeout" }));
    for (let i = 0; i < OVERLOAD_TRIP_COUNT - 1; i++) await target.fetch(`${API}/rest/v1/leads?select=id`);
    await settle();
    expect(isBackgroundPollPaused()).toBe(false);
    await target.fetch(`${API}/rest/v1/notifications?select=id`);
    await settle();
    expect(isBackgroundPollPaused()).toBe(true);
    expect(msUntilBackgroundResume()).toBe(OVERLOAD_BASE_COOLDOWN_MS);
  });

  it("counts statement and connection-pool timeouts reported in a 500 body, but not other errors", async () => {
    const codes = ["57014", "PGRST003", "42501", "23505", "PGRST116"];
    const { target } = guarded((url) => json(500, { code: codes[Number(new URL(url).searchParams.get("i"))] }));
    for (let i = 0; i < codes.length; i++) await target.fetch(`${API}/rest/v1/rpc/x?i=${i}`, { method: "POST" });
    await settle();
    expect(isBackgroundPollPaused()).toBe(false); // only 2 of 5 were overload signals
    await target.fetch(`${API}/rest/v1/rpc/x?i=0`, { method: "POST" });
    await target.fetch(`${API}/rest/v1/rpc/x?i=1`, { method: "POST" });
    await settle();
    expect(isBackgroundPollPaused()).toBe(true);
  });

  it("ignores permission errors, missing rows, other hosts and slow-but-successful responses", async () => {
    const { target } = guarded((url) => (url.includes("example.com") ? json(504, {}) : json(403, { code: "42501" })));
    for (let i = 0; i < 10; i++) {
      await target.fetch(`${API}/rest/v1/leads`);
      await target.fetch("https://example.com/rest/v1/x");
    }
    await settle();
    expect(isBackgroundPollPaused()).toBe(false);
  });

  it("only trips on failures close together, not a few spread over time", () => {
    for (let i = 0; i < 10; i++) {
      recordOverloadResponse();
      vi.advanceTimersByTime(OVERLOAD_WINDOW_MS / 2);
    }
    expect(isBackgroundPollPaused()).toBe(false);
  });
});

describe("never blocking user actions", () => {
  it("still sends every request, saves included, and returns the response unchanged while paused", async () => {
    const { target, calls } = guarded((_url, init) => (init?.method === "PATCH" ? json(200, [{ id: "lead-1" }]) : json(504, {})));
    for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) await target.fetch(`${API}/rest/v1/leads`);
    await settle();
    expect(isBackgroundPollPaused()).toBe(true);

    const save = await target.fetch(`${API}/rest/v1/leads?id=eq.lead-1`, { method: "PATCH", body: "{}" });
    const open = await target.fetch(`${API}/rest/v1/leads?id=eq.lead-1`);
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual([{ id: "lead-1" }]);
    expect(open.status).toBe(504);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(calls).toHaveLength(OVERLOAD_TRIP_COUNT + 2);
  });
});

describe("recovering", () => {
  const trip = () => { for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse(); };

  it("resumes after the cooldown and tells listeners both times", () => {
    const listener = vi.fn();
    const stop = subscribeOverload(listener);
    trip();
    expect(isBackgroundPollPaused()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(OVERLOAD_BASE_COOLDOWN_MS);
    expect(isBackgroundPollPaused()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("doubles the pause while the overload keeps coming back, up to the maximum", () => {
    const pauses: number[] = [];
    for (let i = 0; i < 6; i++) {
      trip();
      pauses.push(msUntilBackgroundResume());
      vi.advanceTimersByTime(msUntilBackgroundResume() + 1_000);
    }
    expect(pauses).toEqual([30_000, 60_000, 120_000, 240_000, OVERLOAD_MAX_COOLDOWN_MS, OVERLOAD_MAX_COOLDOWN_MS]);
  });

  it("starts again from the short pause for a new incident later", () => {
    trip();
    vi.advanceTimersByTime(OVERLOAD_BASE_COOLDOWN_MS);
    trip();
    expect(msUntilBackgroundResume()).toBe(2 * OVERLOAD_BASE_COOLDOWN_MS);
    vi.advanceTimersByTime(2 * OVERLOAD_BASE_COOLDOWN_MS + OVERLOAD_INCIDENT_GAP_MS + 1);
    trip();
    expect(msUntilBackgroundResume()).toBe(OVERLOAD_BASE_COOLDOWN_MS);
  });

  it("spreads each tab's resume over a few seconds so tabs do not all return at once", () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    trip();
    expect(msUntilBackgroundResume()).toBe(OVERLOAD_BASE_COOLDOWN_MS + OVERLOAD_RESUME_JITTER_MS / 2);
  });

  it("stretches a background poll's next turn to the end of the pause, and not otherwise", () => {
    expect(backgroundDelay(15_000)).toBe(15_000);
    trip();
    expect(backgroundDelay(15_000)).toBe(OVERLOAD_BASE_COOLDOWN_MS);
    expect(backgroundDelay(10 * 60_000)).toBe(10 * 60_000);
  });
});

describe("acting on the server's announced load level (before any timeouts)", () => {
  it("pauses background polling the moment the server says critical, with no failed request needed", () => {
    expect(isBackgroundPollPaused()).toBe(false);
    setServerLoadLevel("critical");
    expect(isBackgroundPollPaused()).toBe(true);
    expect(getServerLoadLevel()).toBe("critical");
  });

  it("does not pause for elevated; it only marks the load as raised", () => {
    setServerLoadLevel("elevated");
    expect(isBackgroundPollPaused()).toBe(false);
    expect(isServerLoadRaised()).toBe(true);
  });

  it("steps down after a short random delay so tabs do not all resume at once", () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    setServerLoadLevel("critical");
    setServerLoadLevel("normal");
    expect(isBackgroundPollPaused()).toBe(true);
    vi.advanceTimersByTime(SERVER_LEVEL_STEP_DOWN_JITTER_MS / 2 - 1);
    expect(isBackgroundPollPaused()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isBackgroundPollPaused()).toBe(false);
    expect(getServerLoadLevel()).toBe("normal");
  });

  it("escalates immediately even while a step-down is pending", () => {
    setServerLoadLevel("elevated");
    setServerLoadLevel("normal");
    setServerLoadLevel("critical");
    expect(isBackgroundPollPaused()).toBe(true);
    vi.advanceTimersByTime(SERVER_LEVEL_STEP_DOWN_JITTER_MS);
    expect(getServerLoadLevel()).toBe("critical");
  });

  it("expires a raised level when the server stops re-announcing it, so a tab is never stuck paused", () => {
    setServerLoadLevel("critical");
    vi.advanceTimersByTime(SERVER_LEVEL_TTL_MS - 1);
    expect(isBackgroundPollPaused()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isBackgroundPollPaused()).toBe(false);
    expect(getServerLoadLevel()).toBe("normal");
  });

  it("stays raised while the server keeps re-announcing every minute", () => {
    setServerLoadLevel("critical");
    for (let minute = 0; minute < 10; minute++) {
      vi.advanceTimersByTime(60_000);
      setServerLoadLevel("critical");
    }
    expect(isBackgroundPollPaused()).toBe(true);
  });

  it("treats unknown or missing levels as normal", () => {
    setServerLoadLevel("critical");
    setServerLoadLevel({ level: "critical" });
    vi.advanceTimersByTime(SERVER_LEVEL_STEP_DOWN_JITTER_MS);
    expect(getServerLoadLevel()).toBe("normal");
    setServerLoadLevel(undefined);
    expect(getServerLoadLevel()).toBe("normal");
  });

  it("tells listeners when the level changes", () => {
    const listener = vi.fn();
    const stop = subscribeOverload(listener);
    setServerLoadLevel("elevated");
    expect(listener).toHaveBeenCalledTimes(1);
    setServerLoadLevel("critical");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("still sends every user request while the server says critical", async () => {
    const { target, calls } = guarded(() => json(200, [{ id: "lead-1" }]));
    setServerLoadLevel("critical");
    const save = await target.fetch(`${API}/rest/v1/leads?id=eq.lead-1`, { method: "PATCH", body: "{}" });
    expect(save.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
