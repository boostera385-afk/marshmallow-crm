import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string; created_at?: string },
  filters: [] as Array<[string, string, unknown]>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, role: "customer_service", fullyAuthenticated: true }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        contains: () => query,
        gte: (column: string, value: unknown) => { state.filters.push([table, column, value]); return query; },
        order: () => Promise.resolve({ data: [], error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    },
  },
}));
vi.mock("./popup-slot", () => ({ useNotificationPopupSlot: () => false }));
import CrmUpdatePopup from "./CrmUpdatePopup";

afterEach(() => { cleanup(); state.filters = []; state.user = { id: "u1" }; });

it("does not show announcements published before the user's account existed", async () => {
  state.user = { id: "u1", created_at: "2026-11-08T10:00:00.000Z" };
  render(<CrmUpdatePopup />);
  await waitFor(() => expect(state.filters).toContainEqual(["crm_updates", "published_at", "2026-11-08T10:00:00.000Z"]));
});
