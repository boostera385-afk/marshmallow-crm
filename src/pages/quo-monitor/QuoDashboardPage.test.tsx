import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuoDashboardPage from "./QuoDashboardPage";

const state = vi.hoisted(() => ({
  total: 101, rows: [], phones: [], preferences: [], display: {},
  from: vi.fn(), subscribe: vi.fn(), removeChannel: vi.fn(),
  client: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "admin" }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data = queryKey[0] === "quo-dashboard-conversations" ? { data: state.rows, count: state.total }
      : queryKey[0] === "quo-phone-numbers" ? state.phones
      : queryKey[0] === "quo-number-preferences" ? state.preferences
      : queryKey[0] === "quo-number-display-map" ? state.display : false;
    return { data, isLoading: false, isRefetching: false, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => state.client,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: state.from,
  channel: () => { const channel = { on: () => channel, subscribe: () => { state.subscribe(); return channel; } }; return channel; },
  removeChannel: state.removeChannel,
} }));
vi.mock("framer-motion", () => ({ motion: { section: ({ children, className }: { children?: ReactNode; className?: string }) => <section className={className}>{children}</section> } }));
vi.mock("@/components/quo-dashboard/QuoNumberDisplayDialog", () => ({ default: () => null }));
vi.mock("@/components/quo-dashboard/QuoChatDialog", () => ({ default: () => null }));
vi.mock("@/components/quo-dashboard/ManageNumbersModal", () => ({ default: () => null }));
beforeEach(() => { vi.clearAllMocks(); state.total = 101; });
afterEach(cleanup);

describe("Quo dashboard exact-total freshness", () => {
  it("refreshes analytics when only the exact total changes, without extra queries or subscriptions", () => {
    const view = render(<QuoDashboardPage />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Analytics/ }), { button: 0, ctrlKey: false });
    const totalValue = () => screen.getAllByText("Total Leads", { selector: "span" })[0].nextElementSibling;
    expect(totalValue()).toHaveTextContent("101");
    // Structural sharing can preserve the displayed page while a new off-page
    // conversation changes the server's exact count.
    state.total = 102;
    view.rerender(<QuoDashboardPage />);
    expect(totalValue()).toHaveTextContent("102");
    expect(state.from).not.toHaveBeenCalled();
    expect(state.subscribe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
  });
});
