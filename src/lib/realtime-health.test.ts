import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECONNECT_JITTER_MS,
  REALTIME_SAFETY_POLL_MS,
  forgetRealtimeChannel,
  isRealtimeHealthy,
  onRealtimeReconnected,
  realtimeAwareInterval,
  reportRealtimeStatus,
  resetRealtimeHealth,
  subscribeRealtimeHealth,
} from "./realtime-health";
import { OVERLOAD_BASE_COOLDOWN_MS, OVERLOAD_TRIP_COUNT, recordOverloadResponse, resetOverloadGuard } from "./overload-guard";

afterEach(resetRealtimeHealth);

describe("realtime health", () => {
  it("is unhealthy until a channel subscribes, so safety nets start at their fast interval", () => {
    expect(isRealtimeHealthy()).toBe(false);
    expect(realtimeAwareInterval(15_000)).toBe(15_000);
    reportRealtimeStatus("global", "SUBSCRIBED");
    expect(isRealtimeHealthy()).toBe(true);
    expect(realtimeAwareInterval(15_000)).toBe(REALTIME_SAFETY_POLL_MS);
  });

  it("is healthy only while every tracked channel is subscribed", () => {
    reportRealtimeStatus("global", "SUBSCRIBED");
    reportRealtimeStatus("notifications", "SUBSCRIBED");
    reportRealtimeStatus("notifications", "CHANNEL_ERROR");
    expect(isRealtimeHealthy()).toBe(false);
    reportRealtimeStatus("notifications", "SUBSCRIBED");
    expect(isRealtimeHealthy()).toBe(true);
    reportRealtimeStatus("leads", "TIMED_OUT");
    expect(isRealtimeHealthy()).toBe(false);
  });

  it("treats a channel removed on purpose as neither healthy nor failed", () => {
    reportRealtimeStatus("global", "SUBSCRIBED");
    reportRealtimeStatus("leads", "CLOSED");
    expect(isRealtimeHealthy()).toBe(false);
    forgetRealtimeChannel("leads");
    expect(isRealtimeHealthy()).toBe(true);
  });

  it("never slows a poll that is already slower than the safety interval", () => {
    expect(realtimeAwareInterval(10 * 60_000, true)).toBe(10 * 60_000);
  });

  it("announces a reconnect only after a failure, not on the first connection, spread over a few seconds", () => {
    vi.useFakeTimers();
    const reconnected = vi.fn();
    const stop = onRealtimeReconnected(reconnected);
    reportRealtimeStatus("global", "SUBSCRIBED");
    vi.advanceTimersByTime(RECONNECT_JITTER_MS);
    expect(reconnected).not.toHaveBeenCalled();
    reportRealtimeStatus("global", "CHANNEL_ERROR");
    reportRealtimeStatus("global", "SUBSCRIBED");
    vi.advanceTimersByTime(RECONNECT_JITTER_MS);
    expect(reconnected).toHaveBeenCalledOnce();
    stop();
    vi.useRealTimers();
  });

  it("holds the catch-up read until an overload pause ends", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reconnected = vi.fn();
    const stop = onRealtimeReconnected(reconnected);
    for (let i = 0; i < OVERLOAD_TRIP_COUNT; i++) recordOverloadResponse();
    reportRealtimeStatus("global", "CHANNEL_ERROR");
    reportRealtimeStatus("global", "SUBSCRIBED");
    vi.advanceTimersByTime(OVERLOAD_BASE_COOLDOWN_MS - 1);
    expect(reconnected).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RECONNECT_JITTER_MS + 1);
    expect(reconnected).toHaveBeenCalledOnce();
    stop();
    resetOverloadGuard();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("cancels a pending catch-up when its consumer unmounts", () => {
    vi.useFakeTimers();
    const reconnected = vi.fn();
    const stop = onRealtimeReconnected(reconnected);
    reportRealtimeStatus("global", "CHANNEL_ERROR");
    reportRealtimeStatus("global", "SUBSCRIBED");
    stop();
    vi.advanceTimersByTime(RECONNECT_JITTER_MS);
    expect(reconnected).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("notifies listeners on each health change", () => {
    const listener = vi.fn();
    const stop = subscribeRealtimeHealth(listener);
    reportRealtimeStatus("global", "SUBSCRIBED");
    reportRealtimeStatus("global", "SUBSCRIBED");
    reportRealtimeStatus("global", "CLOSED");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
