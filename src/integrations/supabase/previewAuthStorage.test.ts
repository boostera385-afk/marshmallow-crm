import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brokeredPreviewStorage } from "./previewAuthStorage";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const EDITOR = "https://lovable.dev";
const postMessage = vi.fn();
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent")!;
function preview(hostname = `id-preview--${PROJECT}.lovableproject.com`) {
  vi.stubGlobal("location", { hostname, ancestorOrigins: [EDITOR] });
  Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
  return brokeredPreviewStorage()!;
}
function reply(requestId: string, value: string, origin = EDITOR) {
  window.dispatchEvent(new MessageEvent("message", { origin, data: { type: "lovable-preview-auth:result", requestId, ok: true, value } }));
}
beforeEach(() => { vi.useFakeTimers(); postMessage.mockClear(); localStorage.clear(); });
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  Object.defineProperty(window, "parent", parentDescriptor);
  localStorage.clear();
});

describe("preview auth broker timer and origin safety", () => {
  it("accepts only the matching trusted reply and clears its timeout/listener", async () => {
    const storage = preview();
    const pending = storage.getItem("synthetic-session");
    const [request, origin] = postMessage.mock.calls[0];
    expect(origin).toBe(EDITOR);
    expect(request).toMatchObject({ projectId: PROJECT, type: "lovable-preview-auth:get" });
    reply(request.requestId, "untrusted", "https://example.invalid");
    reply("another-request", "wrong-request");
    expect(vi.getTimerCount()).toBe(1);
    reply(request.requestId, "synthetic-session-value");
    expect(await pending).toBe("synthetic-session-value");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries the first timeout once, then falls back locally without leaking timers", async () => {
    localStorage.setItem("synthetic-session", "local-synthetic-value");
    const pending = preview().getItem("synthetic-session");
    await vi.advanceTimersByTimeAsync(4250);
    expect(await pending).toBe("local-synthetic-value");
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a broker logout tombstone rather than restoring an old local session", async () => {
    localStorage.setItem("synthetic-session", "stale-synthetic-value");
    const pending = preview().getItem("synthetic-session");
    reply(postMessage.mock.calls[0][0].requestId, "");
    expect(await pending).toBeNull();
    expect(localStorage.getItem("synthetic-session")).toBeNull();
    // jsdom schedules storage events separately from the broker's timeout.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not broker sessions from a lookalike untrusted hostname", () => {
    expect(preview(`id-preview--${PROJECT}.lovableproject.com.example.invalid`)).toBe(localStorage);
    expect(postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
