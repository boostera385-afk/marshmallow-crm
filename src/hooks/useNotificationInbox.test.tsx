import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string; created_at?: string }, fetchInbox: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, role: "processor" }) }));
vi.mock("@/lib/workflow-inbox", () => ({ fetchInbox: state.fetchInbox }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget(), subscribeToNotifications: () => () => undefined }));
import { useNotificationInbox } from "./useNotificationInbox";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const filters = { view: "all" as const, category: "all" as const, search: "" };
afterEach(() => { state.fetchInbox.mockReset(); state.user = { id: "u1" }; });

it("notification history covers the last 30 days only", async () => {
  state.fetchInbox.mockResolvedValue({ rows: [], total: 0, unread_count: 0 });
  const now = Date.now();
  renderHook(() => useNotificationInbox(filters, 0), { wrapper });
  await waitFor(() => expect(state.fetchInbox).toHaveBeenCalled());
  const since = Date.parse(state.fetchInbox.mock.calls[0][0].since);
  expect(Math.abs(since - (now - 30 * 24 * 60 * 60 * 1000))).toBeLessThan(60_000);
});

it("keeps a narrower date filter and never shows anything before the account existed", async () => {
  state.fetchInbox.mockResolvedValue({ rows: [], total: 0, unread_count: 0 });
  const narrower = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  renderHook(() => useNotificationInbox({ ...filters, since: narrower }, 0), { wrapper });
  await waitFor(() => expect(state.fetchInbox).toHaveBeenCalled());
  expect(state.fetchInbox.mock.calls[0][0].since).toBe(narrower);

  state.fetchInbox.mockClear();
  state.user = { id: "u2", created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  renderHook(() => useNotificationInbox(filters, 0), { wrapper });
  await waitFor(() => expect(state.fetchInbox).toHaveBeenCalled());
  expect(state.fetchInbox.mock.calls[0][0].since).toBe(state.user.created_at);
});
