import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCHEMA_DOMAINS,
  UNGROUPED_DOMAIN_ID,
  buildSchemaTree,
  parseSupabaseTypes,
  tableMatches,
} from "@/lib/schema-tree";

const typesSource = readFileSync(resolve(__dirname, "../integrations/supabase/types.ts"), "utf8");
const schema = parseSupabaseTypes(typesSource);

const FIXTURE = `export type Database = {
  public: {
    Tables: {
      leads: {
        Row: {
          id: string
          assigned_cs: string | null
          status: Database["public"]["Enums"]["lead_status"]
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_cs_fkey"
            columns: ["assigned_cs"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_cs_fkey"
            columns: ["assigned_cs"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      mystery_table: {
        Row: {
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
        }
        Insert: {
          id: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          id: string | null
        }
        Insert: {
          id?: string | null
        }
        Update: {
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      advance: { Args: never; Returns: string }
      approve_thing: {
        Args: { p_lead_id: string; p_reason?: string }
        Returns: undefined
      }
      overloaded:
        | { Args: { a: number }; Returns: number }
        | { Args: { b: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "admin"
        | "processor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "processor"],
    },
  },
} as const
`;

describe("parseSupabaseTypes", () => {
  const parsed = parseSupabaseTypes(FIXTURE);

  it("reads columns with nullability and types", () => {
    const leads = parsed.tables.find((t) => t.name === "leads")!;
    expect(leads.columns).toEqual([
      { name: "id", type: "string", nullable: false },
      { name: "assigned_cs", type: "string", nullable: true },
      { name: "status", type: 'Database["public"]["Enums"]["lead_status"]', nullable: false },
    ]);
  });

  it("folds links to profiles_public into one link to profiles", () => {
    const leads = parsed.tables.find((t) => t.name === "leads")!;
    expect(leads.foreignKeys).toEqual([{ columns: ["assigned_cs"], table: "profiles" }]);
  });

  it("reads views, function arguments (incl. overloads) and enums from the public schema only", () => {
    expect(parsed.views.map((v) => v.name)).toEqual(["profiles_public"]);
    expect(parsed.functions).toEqual([
      { name: "advance", args: [] },
      { name: "approve_thing", args: ["p_lead_id", "p_reason"] },
      { name: "overloaded", args: ["a", "b"] },
    ]);
    expect(parsed.enums).toEqual([{ name: "app_role", values: ["admin", "processor"] }]);
  });

  it("returns an empty schema for text without a public schema", () => {
    expect(parseSupabaseTypes("nothing here")).toEqual({ tables: [], views: [], functions: [], enums: [] });
  });
});

describe("buildSchemaTree", () => {
  it("adds reverse links and keeps tables missing from the map under Not yet grouped", () => {
    const tree = buildSchemaTree(parseSupabaseTypes(FIXTURE), [
      { id: "core", label: "Core", description: "", tables: { leads: "Jobs", profiles: "People", gone_table: "Dropped" } },
    ]);
    expect(tree.map((d) => d.id)).toEqual(["core", UNGROUPED_DOMAIN_ID]);
    expect(tree[0].tables.map((t) => t.name)).toEqual(["leads", "profiles"]);
    expect(tree[0].tables[1].referencedBy).toEqual([{ table: "leads", columns: ["assigned_cs"] }]);
    expect(tree[1].tables.map((t) => [t.name, t.purpose])).toEqual([["mystery_table", null]]);
  });

  it("filters by table name, purpose or column", () => {
    const [core] = buildSchemaTree(parseSupabaseTypes(FIXTURE), [
      { id: "core", label: "Core", description: "", tables: { leads: "Jobs for customers", profiles: "People" } },
    ]);
    const [leads, profiles] = core.tables;
    expect(tableMatches(leads, "ASSIGNED")).toBe(true);
    expect(tableMatches(leads, "customers")).toBe(true);
    expect(tableMatches(profiles, "assigned")).toBe(false);
    expect(tableMatches(profiles, "  ")).toBe(true);
  });
});

describe("Marshmallow schema map against the generated types", () => {
  it("parses the real public schema", () => {
    const leads = schema.tables.find((t) => t.name === "leads");
    expect(leads?.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["id", "status", "diagnostic_fee_amount"]));
    expect(schema.views.map((v) => v.name)).toContain("profiles_public");
    expect(schema.functions.length).toBeGreaterThan(50);
    expect(schema.enums.find((e) => e.name === "app_role")?.values).toEqual(
      expect.arrayContaining(["admin", "cs_admin", "customer_service", "processor", "opr", "opr_admin"]),
    );
  });

  it("places every table in exactly one area and names no table that does not exist", () => {
    const mapped = SCHEMA_DOMAINS.flatMap((d) => Object.keys(d.tables));
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual(schema.tables.map((t) => t.name).sort());
    const tree = buildSchemaTree(schema);
    expect(tree.some((d) => d.id === UNGROUPED_DOMAIN_ID)).toBe(false);
    tree.flatMap((d) => d.tables).forEach((t) => expect(t.purpose?.length).toBeGreaterThan(0));
  });

  it("only links to tables that exist", () => {
    const names = new Set(schema.tables.map((t) => t.name));
    schema.tables.flatMap((t) => t.foreignKeys).forEach((fk) => expect(names.has(fk.table)).toBe(true));
  });
});
