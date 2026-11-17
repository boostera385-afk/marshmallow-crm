import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_LEAD_STATUSES, ALL_NAV_ITEMS } from "@/lib/constants";
import {
  DONUT_CAPABILITIES,
  EDGE_FUNCTIONS,
  EDGE_FUNCTION_GROUPS,
  LEAD_JOURNEY,
  SCREENS,
  defaultRolesFor,
  screenAccessRule,
  screenLabel,
} from "@/lib/app-structure";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
  });
}

const functionDirs = readdirSync(join(root, "supabase/functions"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, "supabase/functions", entry.name, "index.ts")))
  .map((entry) => entry.name)
  .sort();

/** CRM source that runs in the app (tests, generated types and documentation text excluded). */
const crmSource = filesUnder("src", [".ts", ".tsx"])
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .filter((path) => !path.endsWith("integrations/supabase/types.ts"))
  .filter((path) => !path.endsWith("lib/app-structure.ts") && !path.endsWith("lib/documentation-content.ts"))
  .map(read)
  .join("\n");

const donutDir = "tmp_extension/quo-crm-extension";
const donutSource = readdirSync(join(root, donutDir))
  .filter((name) => name.endsWith(".js"))
  .map((name) => read(`${donutDir}/${name}`))
  .join("\n");

const calls = (source: string, name: string) =>
  new RegExp(`invoke\\(\\s*["'\`]${name}["'\`]|functions/v1/${name}\\b`).test(source);

describe("Edge Functions in the structure map", () => {
  it("lists every deployable function exactly once, in a known group", () => {
    const names = EDGE_FUNCTIONS.map((fn) => fn.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(functionDirs);
    EDGE_FUNCTIONS.forEach((fn) => {
      expect(EDGE_FUNCTION_GROUPS).toContain(fn.group);
      expect(fn.purpose.length).toBeGreaterThan(10);
    });
  });

  it.each(EDGE_FUNCTIONS.map((fn) => [fn.name, fn] as const))("%s: CRM and Donut callers match the code", (name, fn) => {
    expect(fn.callers.includes("crm")).toBe(calls(crmSource, name));
    expect(fn.callers.includes("donut")).toBe(calls(donutSource, name));
  });
});

describe("Screens in the structure map", () => {
  it("covers every navigation item once", () => {
    const keys = SCREENS.map((screen) => screen.navItem);
    expect([...keys].sort()).toEqual([...ALL_NAV_ITEMS].sort());
    keys.forEach((key) => {
      expect(screenLabel(key)).not.toBe(key);
      expect(screenAccessRule(key).length).toBeGreaterThan(0);
    });
  });

  it("uses the real route for each screen", () => {
    const app = read("src/App.tsx");
    SCREENS.filter((screen) => screen.path).forEach((screen) => {
      const route = new RegExp(`path="${screen.path!.slice(1)}" element=\\{<PageRoute navItem=(?:"${screen.navItem}"|\\{\\[[^\\]]*"${screen.navItem}")`);
      expect(app).toMatch(route);
    });
  });

  it("only names Edge Functions the CRM actually calls", () => {
    const crmFunctions = new Set(EDGE_FUNCTIONS.filter((fn) => fn.callers.includes("crm")).map((fn) => fn.name));
    SCREENS.flatMap((screen) => screen.edgeFunctions).forEach((name) => expect(crmFunctions.has(name)).toBe(true));
  });

  it("derives default roles from the access rules", () => {
    expect(defaultRolesFor("payment_requests")).toEqual(["admin"]);
    expect(defaultRolesFor("leads")).toEqual(["admin", "cs_admin", "customer_service", "processor", "opr", "opr_admin"]);
    expect(defaultRolesFor("processor_board")).toEqual(["admin", "processor"]);
  });
});

describe("Donut in the structure map", () => {
  const listed = DONUT_CAPABILITIES.flatMap((capability) => capability.talksTo);

  it("names only Edge Functions, database functions, tables and buckets Donut really uses", () => {
    listed.forEach(({ kind, name }) => {
      if (kind === "edge") expect(calls(donutSource, name)).toBe(true);
      if (kind === "rpc") expect(donutSource).toMatch(new RegExp(`rpc\\(\\s*["']${name}["']`));
      if (kind === "table") expect(donutSource).toMatch(new RegExp(`\\.from\\(\\s*["']${name}["']`));
      if (kind === "storage") expect(donutSource).toMatch(new RegExp(`storage\\s*\\.from\\(\\s*["']${name}["']`));
    });
  });

  it("leaves out nothing Donut calls", () => {
    const has = (kind: string, name: string) => listed.some((target) => target.kind === kind && target.name === name);
    [...donutSource.matchAll(/rpc\(\s*["']([a-z_]+)["']/g)].forEach(([, name]) => expect(has("rpc", name)).toBe(true));
    [...donutSource.matchAll(/(?<!storage)\.from\(\s*["']([a-z_]+)["']/g)].forEach(([, name]) => expect(has("table", name)).toBe(true));
    [...donutSource.matchAll(/storage\s*\.from\(\s*["']([a-z_-]+)["']/g)].forEach(([, name]) => expect(has("storage", name)).toBe(true));
    [...donutSource.matchAll(/invoke\(\s*["']([a-z-]+)["']/g)].forEach(([, name]) => expect(has("edge", name)).toBe(true));
  });
});

describe("Lead journey", () => {
  it("uses real statuses and Edge Functions", () => {
    const functionNames = new Set(EDGE_FUNCTIONS.map((fn) => fn.name));
    LEAD_JOURNEY.forEach((step) => {
      step.statuses.forEach((status) => expect(ALL_LEAD_STATUSES).toContain(status));
      step.edgeFunctions.forEach((name) => expect(functionNames.has(name)).toBe(true));
    });
  });
});
