import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrossTabProvider } from "@/hooks/useCrossTab";
import { createFakeTab, FakeChannelHub, FakeLocks, flush } from "@/test/cross-tab-fakes";

type Announcement = {
  id: string;
  title: string;
  description: string;
  affected_section: string;
  target_roles: string[];
  priority: "normal" | "important";
  is_active: boolean;
  published_at: string;
};

const announcement = (id: string, title: string): Announcement => ({
  id,
  title,
  description: `${title} description`,
  affected_section: "general",
  target_roles: ["customer_service"],
  priority: "normal",
  is_active: true,
  published_at: "2026-11-10T10:00:00.000Z",
});

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string; created_at?: string },
  role: "customer_service",
  fullyAuthenticated: true,
  updates: [] as Announcement[],
  receipts: new Set<string>(),
  reads: 0,
  filters: [] as Array<[string, string, unknown]>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  ignoreReceipts: false,
  insertError: null as null | { message: string },
  popupVisible: true,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user, role: state.role, fullyAuthenticated: state.fullyAuthenticated }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        contains: () => query,
        gte: (column: string, value: unknown) => {
          state.filters.push([table, column, value]);
          return query;
        },
        order: () => query,
        insert: (row: Record<string, unknown>) => {
          state.inserts.push({ table, row });
          if (state.insertError) return Promise.resolve({ error: state.insertError });
          if (table === "crm_update_receipts") state.receipts.add(String(row.notification_id));
          return Promise.resolve({ error: null });
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (table === "crm_updates") {
            state.reads += 1;
            return Promise.resolve({ data: state.updates, error: null }).then(resolve, reject);
          }
          const data = state.ignoreReceipts
            ? []
            : [...state.receipts].map((notification_id) => ({ notification_id }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  },
}));

vi.mock("./popup-slot", () => ({ useNotificationPopupSlot: () => state.popupVisible }));

import CrmUpdatePopup from "./CrmUpdatePopup";

afterEach(() => {
  cleanup();
  state.user = { id: "u1" };
  state.role = "customer_service";
  state.fullyAuthenticated = true;
  state.updates = [];
  state.receipts = new Set();
  state.reads = 0;
  state.filters = [];
  state.inserts = [];
  state.ignoreReceipts = false;
  state.insertError = null;
  state.popupVisible = true;
});

function oneTab() {
  const tab = createFakeTab(new FakeLocks(), new FakeChannelHub(), true);
  return { tab, view: render(<CrossTabProvider coordinator={tab.coordinator}><CrmUpdatePopup /></CrossTabProvider>) };
}

it("does not show announcements published before the user's account existed", async () => {
  state.user = { id: "u1", created_at: "2026-11-08T10:00:00.000Z" };
  oneTab();
  await waitFor(() => expect(state.filters).toContainEqual(["crm_updates", "published_at", "2026-11-08T10:00:00.000Z"]));
});

it("acknowledges an announcement and ignores a stale unread refresh", async () => {
  state.updates = [announcement("a", "Update A")];
  state.ignoreReceipts = true; // simulate a read that started before the acknowledgement
  oneTab();

  expect(await screen.findByText("Update A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Got It/i }));
  await waitFor(() => expect(screen.queryByText("Update A")).toBeNull());

  const readsBeforeRefresh = state.reads;
  fireEvent.focus(window);
  await waitFor(() => expect(state.reads).toBeGreaterThan(readsBeforeRefresh));
  await flush(20);
  expect(screen.queryByText("Update A")).toBeNull();
  expect(state.receipts.has("a")).toBe(true);
  expect(state.inserts).toContainEqual({
    table: "crm_update_receipts",
    row: { notification_id: "a", user_id: "u1" },
  });
});

it("still shows a genuinely new announcement after an acknowledgement", async () => {
  state.updates = [announcement("a", "Update A")];
  state.ignoreReceipts = true;
  oneTab();

  expect(await screen.findByText("Update A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Got It/i }));
  await waitFor(() => expect(screen.queryByText("Update A")).toBeNull());

  state.updates = [announcement("a", "Update A"), announcement("b", "Update B")];
  fireEvent.focus(window);
  expect(await screen.findByText("Update B")).toBeTruthy();
  expect(screen.queryByText("Update A")).toBeNull();
});

it("retires the previous user's queue when the account scope changes", async () => {
  state.updates = [announcement("a", "Update A")];
  const tab = createFakeTab(new FakeLocks(), new FakeChannelHub(), true);
  const view = render(<CrossTabProvider coordinator={tab.coordinator}><CrmUpdatePopup /></CrossTabProvider>);
  expect(await screen.findByText("Update A")).toBeTruthy();

  state.user = { id: "u2" };
  state.updates = [announcement("b", "Update B")];
  view.rerender(<CrossTabProvider coordinator={tab.coordinator}><CrmUpdatePopup /></CrossTabProvider>);

  expect(await screen.findByText("Update B")).toBeTruthy();
  expect(screen.queryByText("Update A")).toBeNull();
});

it("reads once when two tabs request the same announcement scope", async () => {
  state.updates = [announcement("a", "Update A")];
  const locks = new FakeLocks();
  const hub = new FakeChannelHub();
  const first = createFakeTab(locks, hub, true);
  const second = createFakeTab(locks, hub, false);
  const firstView = render(<CrossTabProvider coordinator={first.coordinator}><CrmUpdatePopup /></CrossTabProvider>);
  const secondView = render(<CrossTabProvider coordinator={second.coordinator}><CrmUpdatePopup /></CrossTabProvider>);

  await waitFor(() => expect(screen.getAllByText("Update A")).toHaveLength(2));
  await flush(30);
  expect(state.reads).toBe(1);

  firstView.unmount();
  secondView.unmount();
});
