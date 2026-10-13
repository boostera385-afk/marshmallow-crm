import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotAccess } from "./useCopilotAccess";
const state = vi.hoisted(() => ({ user: { id: "admin" }, role: "admin", fullyAuthenticated: true, profileLoaded: true, fetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/copilot-api", () => ({ fetchCopilotAccess: state.fetch }));
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return renderHook(() => useCopilotAccess(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { state.user = { id: "admin" }; state.role = "admin"; state.fullyAuthenticated = true; state.profileLoaded = true; state.fetch.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });
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
});
