import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Is realtime delivering changes right now?
 *
 * Screens whose data arrives by realtime still keep a polling "safety net" for
 * missed events. While every tracked channel is SUBSCRIBED those nets can run
 * rarely; the moment a channel errors, times out or closes they return to their
 * normal fast interval, and when realtime recovers each consumer refreshes once
 * to pick up anything sent while it was down. Users never wait longer than
 * before: changes arrive instantly, and polling speeds up as soon as realtime
 * cannot be trusted.
 */

/** Safety-net interval while realtime is healthy. */
export const REALTIME_SAFETY_POLL_MS = 2 * 60 * 1000;

type ChannelStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR" | string;

const channels = new Map<string, boolean>();
const listeners = new Set<() => void>();
let healthy = false;
/** Set once a tracked channel has failed; a later recovery is a "reconnect". */
let hadFailure = false;
export const REALTIME_RECONNECTED_EVENT = "realtime:reconnected";
const reconnectTarget = new EventTarget();

function recompute() {
  const next = channels.size > 0 && [...channels.values()].every(Boolean);
  if (next === healthy) return;
  healthy = next;
  if (healthy && hadFailure) {
    hadFailure = false;
    reconnectTarget.dispatchEvent(new Event(REALTIME_RECONNECTED_EVENT));
  }
  listeners.forEach((listener) => listener());
}

/** Record a channel's subscribe() status. Unknown statuses count as unhealthy. */
export function reportRealtimeStatus(channel: string, status: ChannelStatus) {
  const ok = status === "SUBSCRIBED";
  if (!ok) hadFailure = true;
  channels.set(channel, ok);
  recompute();
}

/** Stop tracking a channel that was removed on purpose (not a failure). */
export function forgetRealtimeChannel(channel: string) {
  if (!channels.delete(channel)) return;
  recompute();
}

export function isRealtimeHealthy() {
  return healthy;
}

export function subscribeRealtimeHealth(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Run `onReconnect` each time realtime recovers after a failure. */
export function onRealtimeReconnected(onReconnect: () => void) {
  const listener = () => onReconnect();
  reconnectTarget.addEventListener(REALTIME_RECONNECTED_EVENT, listener);
  return () => reconnectTarget.removeEventListener(REALTIME_RECONNECTED_EVENT, listener);
}

/** Polling interval for a realtime-backed safety net: rare while healthy, `fastMs` otherwise. */
export function realtimeAwareInterval(fastMs: number, isHealthy: boolean = healthy) {
  return isHealthy ? Math.max(fastMs, REALTIME_SAFETY_POLL_MS) : fastMs;
}

export function useRealtimeHealthy() {
  return useSyncExternalStore(subscribeRealtimeHealth, isRealtimeHealthy, isRealtimeHealthy);
}

/** The current safety-net interval for a poll that normally runs every `fastMs`. */
export function useRealtimeAwareInterval(fastMs: number) {
  return realtimeAwareInterval(fastMs, useRealtimeHealthy());
}

/** Calls the latest `onReconnect` whenever realtime recovers after a failure. */
export function useRealtimeReconnect(onReconnect: () => void, enabled: boolean = true) {
  const ref = useRef(onReconnect);
  useEffect(() => { ref.current = onReconnect; }, [onReconnect]);
  useEffect(() => {
    if (!enabled) return;
    return onRealtimeReconnected(() => ref.current());
  }, [enabled]);
}

/** Test helper: forget every tracked channel and listener state. */
export function resetRealtimeHealth() {
  channels.clear();
  healthy = false;
  hadFailure = false;
  listeners.forEach((listener) => listener());
}
