import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkflowAlerts from "./WorkflowAlerts";
import { setWorkflowSounds } from "@/lib/workflow-alerts";
const state = vi.hoisted(() => ({ user: { id: "synthetic-a" }, role: "processor", fetch: vi.fn(), custom: vi.fn(), dismiss: vi.fn(), sound: vi.fn(), listener: null as null | (() => void), unsubscribe: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, role: state.role }) }));
vi.mock("@/lib/workflow-inbox", () => ({ fetchWorkflowAlerts: state.fetch, openInboxNotification: vi.fn() }));
vi.mock("@/lib/notification-sound", () => ({ playAssignmentSound: state.sound }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget(), subscribeToNotifications: (_user: string, listener: () => void) => { state.listener = listener; return state.unsubscribe; } }));
vi.mock("sonner", () => ({ toast: { custom: state.custom, dismiss: state.dismiss, error: vi.fn() } }));
const event = { id: "event-a", title: "CS Updated", message: "Job SYN-1 needs review", read: false, lead_id: null, event_type: "update_answered", created_at: "2026-10-20T00:00:00Z" };
const empty = { rows: [], total: 0, unread_count: 0 };
const mount = () => render(<MemoryRouter><WorkflowAlerts /></MemoryRouter>);
beforeEach(() => {
  state.user = { id: "synthetic-a" }; state.role = "processor";
  state.fetch.mockReset().mockResolvedValue(empty); state.custom.mockReset(); state.dismiss.mockReset(); state.sound.mockReset(); state.unsubscribe.mockReset();
  localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_key: string, action: () => unknown) => Promise.resolve(action()) } });
  setWorkflowSounds(state.user.id, true);
});
afterEach(cleanup);
it("deduplicates polling/realtime delivery and chimes once for a burst", async () => {
  state.fetch.mockResolvedValue({ rows: [event, { ...event, id: "event-b" }], total: 2, unread_count: 2 });
  mount(); await waitFor(() => expect(state.custom).toHaveBeenCalledTimes(2));
  expect(state.sound).toHaveBeenCalledTimes(1);
  await act(async () => { for (let n = 0; n < 50; n++) state.listener?.(); });
  expect(state.custom).toHaveBeenCalledTimes(2); expect(state.sound).toHaveBeenCalledTimes(1);
  expect(state.fetch).toHaveBeenCalledTimes(2); // Initial + one coalesced burst, not 51.
});
it("does not advance the cursor on failed reads and recovers on the next event", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  state.fetch.mockRejectedValueOnce(new Error("Offline")); mount();
  await waitFor(() => expect(warn).toHaveBeenCalled());
  expect(localStorage.getItem(`workflow-alerts:${state.user.id}:cursor`)).toBeNull();
  state.fetch.mockResolvedValue({ rows: [event], total: 1, unread_count: 1 });
  await act(async () => { state.listener?.(); });
  await waitFor(() => expect(state.custom).toHaveBeenCalledOnce()); warn.mockRestore();
});
it("rejects a previous account's delayed result", async () => {
  let resolve!: (value: unknown) => void;
  state.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = mount(); await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
  state.user = { id: "synthetic-b" };
  view.rerender(<MemoryRouter><WorkflowAlerts /></MemoryRouter>);
  await act(async () => { resolve({ rows: [event], total: 1, unread_count: 1 }); });
  expect(state.custom).not.toHaveBeenCalled(); expect(state.sound).not.toHaveBeenCalled();
});
it("cleans up shown notices and the shared subscription on unmount", async () => {
  state.fetch.mockResolvedValue({ rows: [event], total: 1, unread_count: 1 });
  const view = mount(); await waitFor(() => expect(state.custom).toHaveBeenCalledOnce());
  view.unmount(); expect(state.dismiss).toHaveBeenCalledWith("workflow:event-a"); expect(state.unsubscribe).toHaveBeenCalledOnce();
});
it("does not fetch or subscribe for excluded roles", async () => {
  state.role = "opr"; mount(); await act(async () => undefined);
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.custom).not.toHaveBeenCalled();
});
