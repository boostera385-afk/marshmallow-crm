import { useSyncExternalStore } from "react";
import { focusManager } from "@tanstack/react-query";

/**
 * Automatic overload backoff for BACKGROUND polling.
 *
 * On 2026-11-07 and 2026-11-09 the database fell behind and every open tab
 * kept re-asking on its timers, so the queue only grew and the database could
 * not recover. This guard watches responses from the Supabase APIs. When the
 * server repeatedly answers with overload responses (gateway timeouts,
 * statement timeouts, connection-pool timeouts), background polls in this tab
 * pause for a cooldown that doubles while the overload persists, then resume.
 *
 * What it never does:
 *  - block or delay a request: user actions (saves, opening a lead, clicking
 *    Refresh) always go straight through, and their results still count;
 *  - touch realtime, which keeps delivering changes throughout;
 *  - read or keep response data other than an error code.
 */

/** Overload responses within the window that trip the guard. */
export const OVERLOAD_TRIP_COUNT = 4;
export const OVERLOAD_WINDOW_MS = 20_000;
/** First pause; doubles each time the overload returns soon after a pause. */
export const OVERLOAD_BASE_COOLDOWN_MS = 30_000;
export const OVERLOAD_MAX_COOLDOWN_MS = 5 * 60_000;
/** A new overload this soon after a pause ended counts as the same incident. */
export const OVERLOAD_INCIDENT_GAP_MS = 2 * 60_000;
/**
 * Each tab resumes up to this much after its cooldown, so tabs that paused
 * together (they see the same overload) do not all come back at the same moment.
 */
export const OVERLOAD_RESUME_JITTER_MS = 5_000;

const OVERLOAD_STATUSES = new Set([503, 504, 520, 521, 522, 523, 524, 525, 544]);
/** Postgres statement timeout, PostgREST "timed out acquiring connection from pool". */
const OVERLOAD_CODES = new Set(["57014", "PGRST003"]);
const SUPABASE_PATH = /^\/(rest|functions|auth)\/v1\//;

/**
 * Level announced by the database's load governor (migration
 * 20261210010000_load_governor.sql) over the "global-app-events" channel.
 *  - elevated: background safety nets keep their slow cadence;
 *  - critical: background polling pauses at once, before any timeouts.
 * The server re-announces a raised level every minute; if it goes quiet the
 * level expires after SERVER_LEVEL_TTL_MS, so a lost connection never leaves a
 * tab paused.
 */
export type ServerLoadLevel = "normal" | "elevated" | "critical";
export const SERVER_LEVEL_TTL_MS = 3 * 60_000;
/** Tabs step DOWN from a raised level after a random delay up to this, so they do not all resume at once. */
export const SERVER_LEVEL_STEP_DOWN_JITTER_MS = 5_000;
const LEVEL_RANK: Record<ServerLoadLevel, number> = { normal: 0, elevated: 1, critical: 2 };
let serverLevel: ServerLoadLevel = "normal";
let serverLevelExpiresAt = 0;
let serverLevelTimer: ReturnType<typeof setTimeout> | null = null;
let serverStepDownTimer: ReturnType<typeof setTimeout> | null = null;
let serverLevelSnapshot: ServerLoadLevel = "normal";

let failures: number[] = [];
let pausedUntil = 0;
let lastPauseEnded = -Infinity;
let cooldownMs = OVERLOAD_BASE_COOLDOWN_MS;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
// useSyncExternalStore needs a stable snapshot between changes.
let pausedSnapshot = false;

function emit() {
  const next = isBackgroundPollPaused();
  const levelChanged = serverLevel !== serverLevelSnapshot;
  serverLevelSnapshot = serverLevel;
  if (next === pausedSnapshot) {
    if (levelChanged) listeners.forEach((listener) => listener());
    return;
  }
  pausedSnapshot = next;
  // TanStack runs a query's refetchInterval tick only while the page counts as
  // focused (unless refetchIntervalInBackground). Reporting "not focused" while
  // paused skips every interval refetch in one place; mount loads, manual
  // refetches and mutations are not affected. Afterwards real focus applies again.
  focusManager.setFocused(next ? false : undefined);
  listeners.forEach((listener) => listener());
}

function pause(now: number) {
  cooldownMs = now - lastPauseEnded <= OVERLOAD_INCIDENT_GAP_MS
    ? Math.min(cooldownMs * 2, OVERLOAD_MAX_COOLDOWN_MS)
    : OVERLOAD_BASE_COOLDOWN_MS;
  const pauseMs = cooldownMs + Math.floor(Math.random() * OVERLOAD_RESUME_JITTER_MS);
  pausedUntil = now + pauseMs;
  lastPauseEnded = pausedUntil;
  failures = [];
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { resumeTimer = null; emit(); }, pauseMs);
  console.warn(`Server overloaded: background refresh paused for ${Math.round(cooldownMs / 1000)}s. User actions are unaffected.`);
  emit();
}

/** Record one overload response (exported for tests and non-fetch callers). */
export function recordOverloadResponse(now: number = Date.now()) {
  if (now < pausedUntil) return; // already paused; the cooldown is running
  failures = failures.filter((at) => now - at < OVERLOAD_WINDOW_MS);
  failures.push(now);
  if (failures.length >= OVERLOAD_TRIP_COUNT) pause(now);
}

/** True while background polls should skip their turn. */
export function isBackgroundPollPaused(now: number = Date.now()) {
  return now < pausedUntil || currentServerLevel(now) === "critical";
}

/** Milliseconds until background polling resumes (0 when not paused). */
export function msUntilBackgroundResume(now: number = Date.now()) {
  const serverPause = currentServerLevel(now) === "critical" ? serverLevelExpiresAt - now : 0;
  return Math.max(0, pausedUntil - now, serverPause);
}

function currentServerLevel(now: number = Date.now()): ServerLoadLevel {
  return serverLevel !== "normal" && now >= serverLevelExpiresAt ? "normal" : serverLevel;
}

/** The governor's level as this tab currently applies it. */
export function getServerLoadLevel(now: number = Date.now()): ServerLoadLevel {
  return currentServerLevel(now);
}

/** True while the server reports elevated or critical load. */
export function isServerLoadRaised(now: number = Date.now()) {
  return currentServerLevel(now) !== "normal";
}

function applyServerLevel(next: ServerLoadLevel) {
  if (serverStepDownTimer) { clearTimeout(serverStepDownTimer); serverStepDownTimer = null; }
  serverLevel = next;
  if (serverLevelTimer) { clearTimeout(serverLevelTimer); serverLevelTimer = null; }
  if (next !== "normal") {
    serverLevelExpiresAt = Date.now() + SERVER_LEVEL_TTL_MS;
    // Heard nothing for the TTL: the governor (or our connection) stopped; drop to normal.
    serverLevelTimer = setTimeout(() => { serverLevelTimer = null; serverLevel = "normal"; emit(); }, SERVER_LEVEL_TTL_MS);
  }
  emit();
}

/**
 * Apply a level announced by the server. Raising applies at once; lowering
 * waits a random 0-5 s so tabs that hear the same announcement do not all
 * resume background work in the same instant. Unknown values count as normal.
 */
export function setServerLoadLevel(level: unknown) {
  const next: ServerLoadLevel = level === "elevated" || level === "critical" ? level : "normal";
  const current = currentServerLevel();
  if (LEVEL_RANK[next] >= LEVEL_RANK[current]) {
    applyServerLevel(next);
    return;
  }
  if (serverStepDownTimer) return; // a step-down is already on its way
  serverStepDownTimer = setTimeout(() => {
    serverStepDownTimer = null;
    applyServerLevel(next);
  }, Math.floor(Math.random() * SERVER_LEVEL_STEP_DOWN_JITTER_MS));
}

export function useServerLoadLevel() {
  return useSyncExternalStore(subscribeOverload, () => serverLevelSnapshot, () => serverLevelSnapshot);
}

/**
 * The delay before a background poll's next turn: `ms` normally, at least the
 * remaining cooldown while paused.
 */
export function backgroundDelay(ms: number, now: number = Date.now()) {
  return Math.max(ms, msUntilBackgroundResume(now));
}

/** For TanStack `refetchInterval`: the normal interval, stretched while paused. */
export function backgroundInterval(ms: number) {
  return () => backgroundDelay(ms);
}

export function subscribeOverload(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBackgroundPollPaused() {
  return useSyncExternalStore(subscribeOverload, () => pausedSnapshot, () => pausedSnapshot);
}

/** Classify a Supabase API response without consuming its body. */
async function isOverloadResponse(response: Response): Promise<boolean> {
  if (OVERLOAD_STATUSES.has(response.status)) return true;
  if (response.status < 500) return false;
  try {
    const body: unknown = await response.clone().json();
    return Boolean(body && typeof body === "object" && "code" in body && OVERLOAD_CODES.has(String((body as { code: unknown }).code)));
  } catch {
    return false;
  }
}

function isSupabaseApi(input: RequestInfo | URL) {
  try {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return url.hostname.endsWith(".supabase.co") && SUPABASE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

let installed = false;
/**
 * Observe Supabase API responses. The Supabase client looks up the global
 * `fetch` on every request, so this sees all of them. Responses are returned
 * unchanged and immediately; classification happens on the side.
 */
export function installOverloadGuard(target: { fetch: typeof fetch } = globalThis) {
  if (installed || typeof target.fetch !== "function") return;
  installed = true;
  const original = target.fetch.bind(target);
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    if (isSupabaseApi(input)) {
      void isOverloadResponse(response).then((overloaded) => { if (overloaded) recordOverloadResponse(); });
    }
    return response;
  };
}

/** Test helper. */
export function resetOverloadGuard() {
  failures = [];
  pausedUntil = 0;
  lastPauseEnded = -Infinity;
  cooldownMs = OVERLOAD_BASE_COOLDOWN_MS;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
  installed = false;
  pausedSnapshot = false;
  serverLevel = "normal";
  serverLevelSnapshot = "normal";
  serverLevelExpiresAt = 0;
  if (serverLevelTimer) clearTimeout(serverLevelTimer);
  if (serverStepDownTimer) clearTimeout(serverStepDownTimer);
  serverLevelTimer = null;
  serverStepDownTimer = null;
  listeners.forEach((listener) => listener());
}
