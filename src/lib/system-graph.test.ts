import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EDGE_FUNCTIONS, SCREENS } from "@/lib/app-structure";
import {
  DATA_HUBS,
  FUNCTION_FACTS,
  SCREEN_DATA,
  buildSystemGraph,
  describeConnections,
  type DataHub,
} from "@/lib/system-graph";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const isFile = (path: string) => existsSync(join(root, path)) && statSync(join(root, path)).isFile();

/** Every local file a file imports, followed recursively (relative and "@/" imports). */
function importClosure(entry: string, skip: (path: string) => boolean = () => false): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || skip(file)) return;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = match[1];
      let base: string | null = null;
      if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
      else if (spec.startsWith(".")) base = normalize(join(dirname(file), spec));
      if (!base) continue;
      const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(isFile);
      if (found) visit(found);
    }
  };
  visit(entry);
  return [...seen];
}

const tablesIn = (source: string) => new Set([...source.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)].map((m) => m[1]));
const hubsFor = (tables: Set<string>) =>
  (Object.keys(DATA_HUBS) as DataHub[]).filter((hub) => DATA_HUBS[hub].tables.some((table) => tables.has(table))).sort();

const functionSource = (name: string) => importClosure(`supabase/functions/${name}/index.ts`).map(read).join("\n");

describe("Edge Function facts match each function's code (with its shared imports)", () => {
  it.each(EDGE_FUNCTIONS.map((fn) => fn.name))("%s", (name) => {
    const source = functionSource(name);
    const facts = FUNCTION_FACTS[name];
    expect(facts, `${name} needs an entry in FUNCTION_FACTS`).toBeDefined();

    // AI and Quo API: exact in both directions.
    expect(Boolean(facts.ai)).toBe(/api\.openai\.com/.test(source));
    expect(Boolean(facts.quoApi)).toBe(/api\.openphone\.com|api\.quo\.com/.test(source));
    expect(Boolean(facts.census)).toBe(/geocoding\.geo\.census\.gov|api\.census\.gov/.test(source));
    // Webhooks: exactly the functions Quo calls.
    expect(Boolean(facts.webhook)).toBe(EDGE_FUNCTIONS.find((fn) => fn.name === name)!.callers.includes("quo"));
    // Google: a claimed use must be in the code. (A shared address helper file also
    // holds the Google URL, so its presence alone does not prove a call.)
    if (facts.google?.includes("maps")) expect(source).toMatch(/maps\.googleapis\.com/);
    if (facts.google?.includes("sheets")) expect(source).toMatch(/script\.google\.com|sheets\.googleapis\.com/);

    // Data: exactly the tables its code reads or writes.
    expect([...facts.data].sort()).toEqual(hubsFor(tablesIn(source)));
    (facts.dataViaDatabaseFunction ?? []).forEach((hub) => expect(facts.data).not.toContain(hub));
  });
});

describe("Screen data matches each screen's code (with the components it imports)", () => {
  const app = read("src/App.tsx");
  const pageFile = new Map<string, string>();
  for (const m of app.matchAll(/import (\w+) from "@\/pages\/([^"]+)"/g)) pageFile.set(m[1], `@/pages/${m[2]}`);
  for (const m of app.matchAll(/const (\w+) = lazy\(\(\) => import\("@\/pages\/([^"]+)"\)\)/g)) pageFile.set(m[1], `@/pages/${m[2]}`);
  const componentsFor = (navItem: string) =>
    [...app.matchAll(/navItem=(?:"(\w+)"|\{\["(\w+)"[^}]*\})>(?:<Suspense fallback=\{<\w+ \/>\}>)?<(\w+)/g)]
      .filter((m) => (m[1] ?? m[2]) === navItem)
      .map((m) => m[3]);

  it.each(SCREENS.filter((screen) => screen.path).map((screen) => screen.navItem))("%s", (navItem) => {
    const files = new Set<string>();
    for (const component of componentsFor(navItem)) {
      const spec = pageFile.get(component);
      expect(spec, `no page import for ${component}`).toBeDefined();
      const base = `src/${spec!.slice(2)}`;
      const entry = [`${base}.tsx`, `${base}.ts`].find(isFile)!;
      importClosure(entry, (path) => /\.test\.tsx?$/.test(path) || path.includes("integrations/supabase")).forEach((f) => files.add(f));
    }
    const detected = hubsFor(tablesIn([...files].map(read).join("\n")));
    expect([...(SCREEN_DATA[navItem] ?? [])].sort()).toEqual(detected);
  });
});

describe("System graph", () => {
  const graph = buildSystemGraph();
  const ids = new Set(graph.nodes.map((node) => node.id));
  const neighbours = (id: string, kind: string) =>
    describeConnections(graph, id)
      .filter((group) => group.kind === kind)
      .flatMap((group) => group.nodeIds)
      .sort();

  it("has unique nodes, every edge joins two real nodes, and every function and screen is a dot", () => {
    expect(ids.size).toBe(graph.nodes.length);
    graph.edges.forEach((edge) => {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    });
    EDGE_FUNCTIONS.forEach((fn) => expect(ids.has(`fn:${fn.name}`)).toBe(true));
    SCREENS.forEach((screen) => expect(ids.has(`screen:${screen.navItem}`)).toBe(true));
  });

  it("shows where AI is used", () => {
    expect(neighbours("svc:openai", "ai")).toEqual(
      EDGE_FUNCTIONS.filter((fn) => FUNCTION_FACTS[fn.name].ai).map((fn) => `fn:${fn.name}`).sort(),
    );
    expect(neighbours("svc:openai", "ai")).toContain("fn:check-urgent-lead");
  });

  it("shows where the Quo API is called and which functions receive Quo webhooks", () => {
    expect(neighbours("svc:quo", "quo-api")).toContain("fn:processor-board");
    expect(neighbours("svc:quo", "webhook")).toEqual(["fn:quo-message-webhook", "fn:quo-webhook"]);
    const groups = describeConnections(graph, "svc:quo").map((group) => group.heading);
    expect(groups).toEqual(expect.arrayContaining(["Quo API is called by", "Sends webhooks to"]));
    expect(describeConnections(graph, "fn:quo-webhook").map((group) => group.heading)).toContain("Receives webhooks from");
  });

  it("shows what reads or changes leads, including Donut and the All Leads screen", () => {
    const leads = neighbours("data:leads", "leads");
    expect(leads).toEqual(expect.arrayContaining(["app:donut", "screen:leads", "fn:check-urgent-lead", "fn:google-sheets-sync"]));
    expect(leads).not.toContain("fn:quo-webhook");
    expect(describeConnections(graph, "data:leads")[0].heading).toBe("Leads are read or changed by");
  });

  it("links scheduled functions to the scheduler and CRM screens to the CRM", () => {
    expect(neighbours("app:scheduler", "scheduled")).toEqual(
      EDGE_FUNCTIONS.filter((fn) => fn.callers.includes("schedule")).map((fn) => `fn:${fn.name}`).sort(),
    );
    expect(neighbours("app:crm", "contains")).toHaveLength(SCREENS.length);
  });
});
