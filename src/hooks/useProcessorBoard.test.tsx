import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProcessorBoard } from "./useProcessorBoard";
const state = vi.hoisted(() => ({ role: "processor", user: "user-a", fetch: vi.fn(), listeners: new Set<() => void>(), activityListeners: new Set<() => void>(), activityScopes: [] as string[][], releases: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: state.user }, role: state.role }) }));
vi.mock("@/lib/processor-board", () => ({ fetchProcessorJobs: state.fetch }));
vi.mock("@/lib/realtime", () => ({ subscribeToProcessorActivity: (ids: string[], listener: () => void) => {
  state.activityScopes.push(ids); if (!ids.length) return () => {};
  state.activityListeners.add(listener); return () => state.activityListeners.delete(listener);
}, subscribeToProcessorBoard: (listener: () => void) => {
  state.listeners.add(listener); return () => { state.listeners.delete(listener); state.releases(); };
} }));
const filters = { offset: 0, search: "", history: false, timezone: "America/New_York" };
const result = { rows: [], total: 0, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" };
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); state.role = "processor"; state.user = "user-a"; state.listeners.clear(); state.activityListeners.clear(); state.activityScopes = [];
  state.fetch.mockResolvedValue(result);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
describe("Processor Board refresh resource behavior", () => {
  it("coalesces bursts and retains one trailing read when changes arrive in-flight", async () => {
    const hook = renderHook(() => useProcessorBoard(filters), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    let resolve!: (data: typeof result) => void;
    state.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    act(() => { for (let i = 0; i < 20; i++) state.listeners.forEach((f) => f()); });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    act(() => { for (let i = 0; i < 20; i++) state.listeners.forEach((f) => f()); });
    await act(async () => resolve(result));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
    hook.unmount(); expect(state.listeners.size).toBe(0);
  });
  it("does not retain another user's result after scope changes and retires subscriptions", async () => {
    const hook = renderHook(() => useProcessorBoard(filters), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    state.user = "user-b"; state.fetch.mockImplementationOnce(() => new Promise(() => {}));
    hook.rerender(); expect(hook.result.current.data).toBeUndefined();
    expect(state.releases).toHaveBeenCalledOnce(); expect(state.listeners.size).toBe(1);
    hook.unmount(); expect(state.listeners.size).toBe(0);
  });
  it("performs no reads or subscriptions for an excluded role", () => {
    state.role = "opr"; renderHook(() => useProcessorBoard(filters), { wrapper });
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });
  it("recovers from a failed read on the next notification", async () => {
    state.fetch.mockRejectedValueOnce(new Error("Synthetic outage"));
    const hook = renderHook(() => useProcessorBoard(filters), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    act(() => state.listeners.forEach((f) => f()));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it("coalesces page-chat and lead bursts together without recreating the lead transport", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const data = { ...result, rows: [{ chat_setup: { conversation_id: id } }] };
    state.fetch.mockResolvedValue(data);
    const hook = renderHook(() => useProcessorBoard(filters), { wrapper });
    await waitFor(() => expect(state.activityListeners.size).toBe(1));
    expect(state.activityScopes.at(-1)).toEqual([id]); expect(state.releases).not.toHaveBeenCalled();
    let resolve!: (value: typeof data) => void;
    state.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    act(() => { for (let i = 0; i < 20; i++) { state.activityListeners.forEach((f) => f()); state.listeners.forEach((f) => f()); } });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    act(() => state.activityListeners.forEach((f) => f()));
    await act(async () => resolve(data));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
    hook.unmount(); expect(state.activityListeners.size).toBe(0); expect(state.listeners.size).toBe(0);
  });
});
