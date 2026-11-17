import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import Settings from "./Settings";

const state = vi.hoisted(() => ({ role: "admin" as AppRole | null }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, role: state.role, profileLoaded: true }),
}));

// Every Supabase read in Settings resolves to an empty result; the Schema Tree
// itself makes no request at all (it reads the bundled generated types).
vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: [], error: null, count: 0 };
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_target, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(empty) : chain),
      apply: () => chain(),
    });
  return { supabase: { from: vi.fn(chain), rpc: vi.fn(chain), functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } };
});
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

afterEach(cleanup);

describe("Settings > Schema Tree", () => {
  it("lets an Admin open the tree, search a column and jump along a link", async () => {
    renderSettings("admin");
    fireEvent.click((await tabs()).getByRole("tab", { name: "Schema Tree" }));
    expect(await screen.findByRole("heading", { name: "Schema Tree" })).toBeInTheDocument();

    const leadsArea = screen.getByRole("button", { name: /^Leads\b/ });
    expect(leadsArea).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(leadsArea);
    expect(leadsArea).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(screen.getByRole("textbox", { name: /Search tables/ }), { target: { value: "diagnostic_fee" } });
    const leadsTable = await screen.findByRole("button", { name: /^leads\b.*Matching columns: diagnostic_fee_amount/ });
    expect(screen.queryByRole("button", { name: /^technicians\b/ })).toBeNull();

    fireEvent.click(leadsTable);
    const profilesLink = screen.getByRole("button", { name: "assigned_cs → profiles" });
    fireEvent.click(profilesLink);
    await waitFor(() => expect(screen.getByRole("button", { name: /^profiles\b/ })).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("textbox", { name: /Search tables/ })).toHaveValue("");
  });

  it("shows a no-match message instead of an empty tree", async () => {
    renderSettings("admin");
    fireEvent.click((await tabs()).getByRole("tab", { name: "Schema Tree" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Search tables/ }), { target: { value: "zz_no_such_thing" } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it.each(["cs_admin", "customer_service", "processor", "opr", "opr_admin"] as const)("does not offer the tab to %s", async (role) => {
    renderSettings(role);
    const tabList = await tabs();
    expect(tabList.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(tabList.queryByRole("tab", { name: "Schema Tree" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Schema Tree" })).toBeNull();
  });
});
