import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import { useLeadCopyAccess, useHoldInbox } from "./useOperatorWorkflow";

const state = vi.hoisted(() => ({ role: "opr" as AppRole | null, user: { id: "synthetic" } as { id: string } | null, copy: vi.fn(), inbox: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/operator-workflow", () => ({ fetchLeadCopyAccess: state.copy, fetchHoldInbox: state.inbox }));
const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  state.role = "opr";
  state.user = { id: "synthetic" };
  state.copy.mockReset();
  state.inbox.mockReset();
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("authenticated copy permission query", () => {
  it.each(["opr", "opr_admin"] as const)("loads and permits the default for %s", async (role) => {
    state.role = role;
    state.copy.mockResolvedValue(true);
    const { result } = renderHook(useLeadCopyAccess, { wrapper });
    expect(result.current.allowed).toBe(false);
    await waitFor(() => expect(result.current.allowed).toBe(true));
  });
  it("fails closed if the backend is unavailable", async () => {
    state.copy.mockRejectedValue(new Error("Migration required"));
    const { result } = renderHook(useLeadCopyAccess, { wrapper });
    await waitFor(() => expect(result.current.error?.message).toBe("Migration required"));
    expect(result.current.allowed).toBe(false);
  });
  it("does not query or grant access to anonymous callers", () => {
    state.role = null;
    state.user = null;
    const { result } = renderHook(useLeadCopyAccess, { wrapper });
    expect(result.current.allowed).toBe(false);
    expect(state.copy).not.toHaveBeenCalled();
  });
  it("retains Admin access without waiting for a backend permission", () => {
    state.role = "admin";
    const { result } = renderHook(useLeadCopyAccess, { wrapper });
    expect(result.current.allowed).toBe(true);
    expect(state.copy).not.toHaveBeenCalled();
  });
});

describe("hold inbox role scope", () => {
  it.each(["opr", "opr_admin"] as const)("recovers saved unread events for %s", async (role) => {
    state.role = role;
    state.inbox.mockResolvedValue({ alerts: [], unread_count: 2 });
    const { result } = renderHook(useHoldInbox, { wrapper });
    await waitFor(() => expect(result.current.data?.unread_count).toBe(2));
  });
  it("does not fetch operator snapshots for an excluded role", () => {
    state.role = "customer_service";
    renderHook(useHoldInbox, { wrapper });
    expect(state.inbox).not.toHaveBeenCalled();
  });
});
