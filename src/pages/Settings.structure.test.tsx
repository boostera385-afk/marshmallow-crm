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
  const item = (name: RegExp) => screen.getByRole("treeitem", { name });
  const level2 = (label: string) =>
    screen.getAllByRole("treeitem").find((el) => el.getAttribute("aria-level") === "2" && el.textContent?.startsWith(label))!;

  it("shows one Marshmallow root with five closed branches that open into deeper levels", async () => {
    renderSettings("admin");
    await openStructure();
    const callsBefore = supabaseMock.functions.invoke.mock.calls.length;

    const tree = screen.getByRole("tree", { name: "Marshmallow structure" });
    const root = within(tree).getByRole("treeitem", { name: /^Marshmallow/ });
    expect(root).toHaveAttribute("aria-level", "1");
    expect(root).toHaveAttribute("aria-expanded", "true");
    const branches = screen.getAllByRole("treeitem").filter((el) => el.getAttribute("aria-level") === "2");
    expect(branches.map((el) => el.textContent?.replace(/\(\d+\).*/, ""))).toEqual(["Lead journey", "CRM screens", "Edge Functions", "Donut extension", "Outside services"]);
    branches.forEach((el) => expect(el).toHaveAttribute("aria-expanded", "false"));

    fireEvent.click(level2("CRM screens"));
    fireEvent.click(item(/^Processor Board$/));
    const roles = screen.getAllByRole("treeitem", { name: /^Opens by default/ });
    expect(roles).toHaveLength(1);
    fireEvent.click(roles[0]);
    expect(roles[0]).toHaveAttribute("aria-level", "4");
    expect(item(/^Admin$/)).toHaveAttribute("aria-level", "5");
    expect(item(/^Processor$/)).toHaveAttribute("aria-level", "5");

    fireEvent.click(level2("CRM screens"));
    expect(screen.queryByRole("treeitem", { name: /^Processor Board$/ })).toBeNull();
    expect(supabaseMock.functions.invoke.mock.calls.length).toBe(callsBefore);
  });

  it("moves and opens with the arrow keys", async () => {
    renderSettings("admin");
    await openStructure();
    const root = item(/^Marshmallow/);
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowDown" });
    const journey = level2("Lead journey");
    expect(journey).toHaveFocus();
    fireEvent.keyDown(journey, { key: "ArrowRight" });
    expect(journey).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(journey, { key: "ArrowRight" });
    expect(item(/^1\. Customer texts or calls in Quo/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(journey).toHaveFocus();
    fireEvent.keyDown(journey, { key: "ArrowLeft" });
    expect(journey).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(journey, { key: "End" });
    expect(level2("Outside services")).toHaveFocus();
    expect(screen.getAllByRole("treeitem").filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it("search opens the path to each match and keeps the rest out", async () => {
    renderSettings("admin");
    await openStructure();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "geocode-lead-address" } });

    const hits = screen.getAllByRole("treeitem", { name: /^geocode-lead-address/ });
    expect(hits.length).toBeGreaterThan(1); // Lead journey, screens, Edge Functions and Donut all reach it.
    const edgeHit = screen.getAllByRole("treeitem", { name: /^geocode-lead-address/ }).find((el) => el.getAttribute("aria-expanded") !== null)!;
    fireEvent.click(edgeHit);
    expect(item(/^Called by: CRM$/)).toBeInTheDocument();
    expect(item(/^Called by: Donut$/)).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /^Technician Intelligence/ })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "zz_nothing" } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it.each(["cs_admin", "customer_service", "processor", "opr", "opr_admin"] as const)("does not offer the tab to %s", async (role) => {
    renderSettings(role);
    const tabList = await tabs();
    expect(tabList.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(tabList.queryByRole("tab", { name: "Structure" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Marshmallow Structure" })).toBeNull();
  });
});
