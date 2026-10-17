import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotAccess } from "./useCopilotAccess";
import { COPILOT_ACCESS_STORAGE_KEY } from "@/lib/copilot-access-events";
const state = vi.hoisted(() => ({ user: { id: "admin" }, role: "admin", fullyAuthenticated: true, profileLoaded: true, fetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/copilot-api", () => ({ fetchCopilotAccess: state.fetch }));
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return renderHook(() => useCopilotAccess(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { state.user = { id: "admin" }; state.role = "admin"; state.fullyAuthenticated = true; state.profileLoaded = true; state.fetch.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.useRealTimers(); });
describe("Copilot access is fail closed", () => {
  it("does not bypass server verification even for Admin", async () => {
    state.fetch.mockRejectedValue(new Error("Not installed")); const { result } = mount();
    await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.access).toBeNull();
  });
  it("hides excluded users even when the response itself succeeds", async () => {
    state.fetch.mockResolvedValue({ allowed: false }); const { result } = mount();
    await waitFor(() => expect(result.current.isSuccess).toBe(true)); expect(result.current.access).toBeNull();
  });
  it("never reuses cached permission when authentication is no longer complete", async () => {
    state.fetch.mockResolvedValue({ allowed: true }); const { result, rerender } = mount();
    await waitFor(() => expect(result.current.access).not.toBeNull()); state.fullyAuthenticated = false; rerender();
    expect(result.current.access).toBeNull();
  });
  it("never offers the old user's access during an identity change", async () => {
    state.fetch.mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false }); const { result, rerender } = mount();
    await waitFor(() => expect(result.current.access).not.toBeNull()); state.user = { id: "excluded" }; state.role = "opr"; rerender();
    expect(result.current.access).toBeNull(); await waitFor(() => expect(result.current.isSuccess).toBe(true)); expect(result.current.access).toBeNull();
  });
  it("rechecks another tab's save instead of trusting a storage signal as a permission", async () => {
    state.fetch.mockResolvedValue({ allowed: true }); const { result } = mount();
    await waitFor(() => expect(result.current.access).not.toBeNull());
    state.fetch.mockResolvedValue({ allowed: false });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: COPILOT_ACCESS_STORAGE_KEY, newValue: "invalidation-only" })); });
    await waitFor(() => expect(result.current.access).toBeNull()); expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it("removes CS access at the next closed-panel poll after server revocation", async () => {
    vi.useFakeTimers(); state.role = "customer_service";
    state.fetch.mockResolvedValue({ allowed: true, aiEnabled: false }); const { result } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.access).not.toBeNull(); state.fetch.mockResolvedValue({ allowed: false, aiEnabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(result.current.access).toBeNull(); expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps deterministic Copilot access when only AI is disabled", async () => {
    state.fetch.mockResolvedValue({ allowed: true, aiEnabled: false }); const { result } = mount();
    await waitFor(() => expect(result.current.access).toMatchObject({ allowed: true, aiEnabled: false }));
  });
});
