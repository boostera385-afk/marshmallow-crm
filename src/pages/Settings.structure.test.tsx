import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import Settings from "./Settings";

const state = vi.hoisted(() => ({ role: "admin" as AppRole | null }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, role: state.role, profileLoaded: true }),
}));

// Every Supabase read in Settings resolves to an empty result. The Structure
// tab itself makes no request: it is built from the app's own access rules.
const supabaseMock = vi.hoisted(() => {
  const empty = { data: [], error: null, count: 0 };
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_target, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(empty) : chain),
      apply: () => chain(),
    });
  return { from: vi.fn(chain), rpc: vi.fn(chain), functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));

function renderSettings(role: AppRole) {
  state.role = role;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

const tabs = async () => within(await screen.findByRole("tablist", { name: "Settings sections" }));
const openStructure = async () => {
  fireEvent.click((await tabs()).getByRole("tab", { name: "Structure" }));
  return screen.findByRole("heading", { name: "Marshmallow Structure" });
};

afterEach(cleanup);

describe("Settings > Structure", () => {
  it("opens on the lead journey and lets an Admin expand screens with their roles and functions", async () => {
    renderSettings("admin");
    await openStructure();
    const callsBefore = supabaseMock.functions.invoke.mock.calls.length;

    expect(screen.getByRole("button", { name: /Lead journey/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("7. Payment")).toBeInTheDocument();

    const screensSection = screen.getByRole("button", { name: /CRM screens/ });
    expect(screensSection).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screensSection);
    expect(screensSection).toHaveAttribute("aria-expanded", "true");

    const board = screen.getByText("Processor Board").closest("li")!;
    expect(within(board).getByText("/processor-board")).toBeInTheDocument();
    expect(within(board).getAllByText(/^(Admin|Processor)$/).map((el) => el.textContent)).toEqual(["Admin", "Processor"]);
    expect(within(board).getByText("processor-board")).toBeInTheDocument();
    expect(supabaseMock.functions.invoke.mock.calls.length).toBe(callsBefore);
  });

  it("searches across sections and shows who calls an Edge Function", async () => {
    renderSettings("admin");
    await openStructure();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "geocode" } });

    const fn = screen.getAllByText("geocode-lead-address").map((el) => el.closest("li")!).find((li) => within(li).queryByText("Donut"));
    expect(fn).toBeDefined();
    expect(within(fn!).getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("Create a lead from a Quo chat")).toBeInTheDocument();
    expect(screen.queryByText("Technician Intelligence")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "zz_nothing" } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it.each(["cs_admin", "customer_service", "processor", "opr", "opr_admin"] as const)("does not offer the tab to %s", async (role) => {
    renderSettings(role);
    const tabList = await tabs();
    expect(tabList.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(tabList.queryByRole("tab", { name: "Structure" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Marshmallow Structure" })).toBeNull();
  });
});
