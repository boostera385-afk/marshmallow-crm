import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole, NavigationPermission } from "@/types";
import { canAccessNavItem } from "@/lib/access";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppSidebar from "./AppSidebar";

const state = vi.hoisted(() => ({
  role: "opr" as AppRole,
  quotationMaster: false,
  permissions: [] as NavigationPermission[],
  reads: [] as string[],
  channels: [] as string[],
  callbacks: new Map<string, () => void>(),
  fail: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "synthetic-user" },
  profile: { id: "synthetic-user", full_name: "Synthetic", is_quotation_master: state.quotationMaster },
  role: state.role,
  signOut: vi.fn(),
  canAccess: (key: string) => key === "quote_pending_requests"
    ? state.role === "admin" || state.quotationMaster
    : canAccessNavItem(state.role, key, state.permissions),
}) }));
vi.mock("@/hooks/useAllowedStatuses", () => ({ useAllowedStatuses: () => ({ allowedStatuses: new Set(["urgent_job"]) }) }));
vi.mock("framer-motion", () => ({ motion: {
  div: ({ children, className }: { children?: ReactNode; className?: string }) => <div className={className}>{children}</div>,
} }));
vi.mock("@/components/auth/ChangePasswordDialog", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const result = { data: [], count: 3, error: state.fail ? { message: "Offline" } : null };
    const query = {
      select: () => { state.reads.push(table); return query; },
      eq: () => query,
      order: () => query,
      range: () => Promise.resolve(result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  },
  rpc: () => Promise.resolve({ data: 0, error: null }),
  channel: (name: string) => {
    state.channels.push(name);
    const channel = {
      on: (_event: string, filter: { table: string }, callback: () => void) => {
        state.callbacks.set(filter.table, callback);
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: vi.fn(),
} }));

const clients: QueryClient[] = [];
function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const ui = <QueryClientProvider client={client}><MemoryRouter><TooltipProvider><SidebarProvider><AppSidebar /></SidebarProvider></TooltipProvider></MemoryRouter></QueryClientProvider>;
  return { ...render(ui), client };
}
beforeEach(() => {
  vi.useFakeTimers();
  state.role = "opr";
  state.quotationMaster = false;
  state.permissions = [];
  state.reads = [];
  state.channels = [];
  state.callbacks.clear();
  state.fail = false;
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sidebar request optimization", () => {
  it("does not fetch or poll badges hidden from an Operator, even after invalidation", async () => {
    const { client } = renderSidebar();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["pending-cancellations-count"] });
      await client.invalidateQueries({ queryKey: ["pending-payment-requests-count"] });
      await client.invalidateQueries({ queryKey: ["pending-quote-requests-count"] });
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.reads).toEqual([]);
    expect(state.channels).not.toContain("lead-cancellations-sidebar-realtime");
    expect(screen.queryByRole("link", { name: /Cancellation requests/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Payment approvals/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Quotes to send/ })).toBeNull();
  });

  it("keeps Admin badges, the existing poll cadence and realtime refresh", async () => {
    state.role = "admin";
    renderSidebar();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.reads.filter((table) => table === "lead_cancellation_requests")).toHaveLength(1);
    expect(state.reads.filter((table) => table === "lead_payment_requests")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Cancellation requests/ }).querySelector(".animate-ping")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(state.reads.filter((table) => table === "lead_cancellation_requests")).toHaveLength(2);
    expect(state.reads.filter((table) => table === "lead_payment_requests")).toHaveLength(1);
    await act(async () => { state.callbacks.get("lead_payment_requests")?.(); });
    expect(state.reads.filter((table) => table === "lead_payment_requests")).toHaveLength(2);
  });

  it("keeps Processor cancellations and per-user quote grants without fetching payments", async () => {
    state.role = "processor";
    state.quotationMaster = true;
    renderSidebar();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.reads).toContain("lead_cancellation_requests");
    expect(state.reads).toContain("leads");
    expect(state.reads).not.toContain("lead_payment_requests");
    expect(screen.getByRole("link", { name: /Quotes to send/ }).querySelector(".animate-ping")).not.toBeNull();
  });

  it("keeps failed count reads from advertising a successful count", async () => {
    state.role = "processor";
    state.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderSidebar();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("link", { name: /Cancellation requests/ }).querySelector(".animate-ping")).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Error fetching pending cancellations count:", "Offline");
  });
});
