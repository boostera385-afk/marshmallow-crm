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
const openOrgChart = async () => {
  await openStructure();
  fireEvent.click(within(screen.getByRole("tablist", { name: "Structure view" })).getByRole("tab", { name: "Org chart" }));
};

afterEach(cleanup);

describe("Settings > Structure > Graph", () => {
  const dot = (id: string) => document.querySelector<SVGGElement>(`[data-node-id="${id}"]`)!;
  const panel = () => within(screen.getByRole("complementary", { name: "Selected item" }));
  const lines = (kind?: string) =>
    document.querySelectorAll(`svg[aria-label="Marshmallow connection graph"] line${kind ? `[data-edge-kind="${kind}"]` : ""}`).length;

  it("opens on the graph, and clicking OpenAI lists every function where AI is used", async () => {
    renderSettings("admin");
    await openStructure();
    const callsBefore = supabaseMock.functions.invoke.mock.calls.length;
    expect(within(screen.getByRole("tablist", { name: "Structure view" })).getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: "Marshmallow connection graph" })).toBeInTheDocument();
    expect(dot("svc:openai")).toHaveAttribute("aria-label", "OpenAI, Outside service");

    fireEvent.pointerDown(dot("svc:openai"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(dot("svc:openai"), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(panel().getByRole("heading", { name: "OpenAI" })).toBeInTheDocument();
    expect(panel().getByText("AI is used by")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "check-urgent-lead" })).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "processor-board" })).toBeInTheDocument();
    expect(panel().queryByRole("button", { name: "quo-webhook" })).toBeNull();
    expect(dot("svc:openai")).toHaveAttribute("aria-pressed", "true");
    expect(supabaseMock.functions.invoke.mock.calls.length).toBe(callsBefore);
  });

  it("explains Quo: where its API is called and which functions receive its webhooks; chips move the selection", async () => {
    renderSettings("admin");
    await openStructure();
    fireEvent.keyDown(dot("svc:quo"), { key: "Enter" });
    expect(panel().getByText("Quo API is called by")).toBeInTheDocument();
    expect(panel().getByText("Sends webhooks to")).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "quo-webhook" }));
    expect(panel().getByRole("heading", { name: "quo-webhook" })).toBeInTheDocument();
    expect(panel().getByText("Receives webhooks from")).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("heading", { name: "quo-webhook" })).toBeNull();
  });

  it("filters to one kind of connection and back", async () => {
    renderSettings("admin");
    await openStructure();
    const all = lines();
    expect(lines("ai")).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole("button", { name: "AI used here" }));
    expect(screen.getByRole("button", { name: "AI used here" })).toHaveAttribute("aria-pressed", "true");
    expect(lines()).toBe(lines("ai"));
    expect(dot("svc:openai")).toHaveAttribute("opacity", "1");
    expect(dot("svc:census")).toHaveAttribute("opacity", "0.18");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(lines()).toBe(all);
  });

  it("finds a dot by name and the jump list selects it", async () => {
    renderSettings("admin");
    await openStructure();
    const find = screen.getByRole("textbox", { name: "Find in the graph" });
    fireEvent.change(find, { target: { value: "leads" } });
    expect(screen.getByText(/found$/)).toBeInTheDocument();
    fireEvent.change(find, { target: { value: "geocode-lead" } });
    expect(screen.getByText("1 found")).toBeInTheDocument();
    fireEvent.keyDown(find, { key: "Enter" });
    expect(panel().getByRole("heading", { name: "geocode-lead-address" })).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Close details" }));
    fireEvent.change(screen.getByLabelText("Or jump to"), { target: { value: "data:leads" } });
    expect(panel().getByRole("heading", { name: "Leads" })).toBeInTheDocument();
    expect(panel().getByText("Leads are read or changed by")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Donut extension" })).toBeInTheDocument();
  });
});

describe("Settings > Structure > Org chart", () => {
  /** A box in the chart, found by its stable node id (fast on a large chart). */
  const box = (id: string) => document.querySelector<HTMLButtonElement>(`button[aria-controls="structure-node-${id}"]`);
  const childrenOf = (id: string) => within(document.getElementById(`structure-node-${id}`)!);
  const BRANCHES = ["journey", "screens", "edge", "donut", "services"];

  it("draws a Marshmallow box above five open branch columns whose boxes open level by level", async () => {
    renderSettings("admin");
    await openOrgChart();
    const callsBefore = supabaseMock.functions.invoke.mock.calls.length;

    const chart = screen.getByRole("region", { name: "Marshmallow org chart" });
    expect(within(chart).getByText("Marshmallow")).toBeInTheDocument();
    expect(BRANCHES.map((id) => box(id)?.textContent?.replace(/\s*\d+$/, ""))).toEqual([
      "Lead journeyFrom a Quo chat to Paid",
      "CRM screensEvery sidebar item and who opens it",
      "Edge FunctionsServer code that holds the secrets",
      "Donut extensionChrome extension used inside Quo",
      "Outside servicesWhat Marshmallow depends on",
    ]);
    BRANCHES.forEach((id) => expect(box(id)).toHaveAttribute("aria-expanded", "true"));

    const board = box("screens/processor_board")!;
    expect(board).toHaveTextContent("Processor Board");
    expect(board).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(board);
    expect(board).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(box("screens/processor_board/roles")!);
    expect(childrenOf("screens/processor_board/roles").getAllByText(/^(Admin|Processor)$/).map((el) => el.textContent)).toEqual(["Admin", "Processor"]);
    fireEvent.click(box("screens/processor_board/fns")!);
    expect(childrenOf("screens/processor_board/fns").getByText("processor-board")).toBeInTheDocument();

    fireEvent.click(box("screens")!);
    expect(box("screens")).toHaveAttribute("aria-expanded", "false");
    expect(box("screens/processor_board")).toBeNull();
    expect(supabaseMock.functions.invoke.mock.calls.length).toBe(callsBefore);
  });

  it("Expand all opens every box and Collapse all returns to the branch columns", async () => {
    renderSettings("admin");
    await openOrgChart();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(box("edge/fn:check-urgent-lead")).toHaveAttribute("aria-expanded", "true");
    expect(childrenOf("edge/fn:check-urgent-lead").getAllByText(/^(CRM|Donut)$/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(box("edge/fn:check-urgent-lead")).toBeNull();
    BRANCHES.forEach((id) => expect(box(id)).toHaveAttribute("aria-expanded", "true"));
  });

  it("search opens the path to each match and keeps the rest out", async () => {
    renderSettings("admin");
    await openOrgChart();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "geocode-lead-address" } });

    expect(box("edge/Leads, addresses & maps")).toHaveAttribute("aria-expanded", "true");
    const fn = box("edge/fn:geocode-lead-address")!;
    expect(fn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fn);
    expect(childrenOf("edge/fn:geocode-lead-address").getAllByText(/^(CRM|Donut)$/).map((el) => el.textContent)).toEqual(["CRM", "Donut"]);
    expect(box("edge/AI checks (advisory)")).toBeNull();
    expect(box("donut/4")).toBeNull(); // Technician Intelligence does not use it

    fireEvent.change(screen.getByRole("textbox", { name: "Search the Marshmallow structure" }), { target: { value: "zz_nothing" } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Marshmallow org chart" })).toBeNull();
  });

  it.each(["cs_admin", "customer_service", "processor", "opr", "opr_admin"] as const)("does not offer the tab to %s", async (role) => {
    renderSettings(role);
    const tabList = await tabs();
    expect(tabList.getByRole("tab", { name: "Security" })).toBeInTheDocument();
    expect(tabList.queryByRole("tab", { name: "Structure" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Marshmallow Structure" })).toBeNull();
  });
});
