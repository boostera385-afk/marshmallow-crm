import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Database, Eye, FunctionSquare, KeyRound, Link2, ListTree, Search, Table2 } from "lucide-react";
import typesSource from "@/integrations/supabase/types.ts?raw";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  buildSchemaTree,
  displayType,
  parseSupabaseTypes,
  tableMatches,
  type ParsedSchema,
  type SchemaTreeDomain,
  type SchemaTreeTable,
} from "@/lib/schema-tree";

function TreeToggle({
  expanded,
  onToggle,
  controls,
  children,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  controls: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "flex w-full min-h-10 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

function TableNode({
  table,
  expanded,
  query,
  onToggle,
  onJump,
}: {
  table: SchemaTreeTable;
  expanded: boolean;
  query: string;
  onToggle: () => void;
  onJump: (name: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const fkColumns = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
  const columnHits = needle ? table.columns.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => c.name) : [];
  const panelId = `schema-table-panel-${table.name}`;

  return (
    <li id={`schema-table-${table.name}`} className="scroll-mt-24">
      <TreeToggle expanded={expanded} onToggle={onToggle} controls={panelId}>
        <span className="flex flex-wrap items-center gap-2">
          <Table2 aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          <code className="text-[13px] font-semibold text-foreground">{table.name}</code>
          <span className="text-[11px] text-muted-foreground">{table.columns.length} columns</span>
          {table.foreignKeys.length > 0 && (
            <span className="text-[11px] text-muted-foreground">· links to {table.foreignKeys.length}</span>
          )}
        </span>
        {table.purpose && <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{table.purpose}</span>}
        {columnHits.length > 0 && (
          <span className="mt-0.5 block text-[11px] text-primary">Matching columns: {columnHits.join(", ")}</span>
        )}
      </TreeToggle>

      {expanded && (
        <div id={panelId} className="ml-6 mt-1 space-y-3 border-l border-border/60 pb-3 pl-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Columns</p>
            <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {table.columns.map((column) => (
                <li key={column.name} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                  {column.name === "id" ? (
                    <KeyRound aria-label="Primary key" className="h-3 w-3 shrink-0 text-amber-500" />
                  ) : fkColumns.has(column.name) ? (
                    <Link2 aria-label="Links to another table" className="h-3 w-3 shrink-0 text-primary" />
                  ) : (
                    <span aria-hidden="true" className="w-3 shrink-0" />
                  )}
                  <code
                    className={cn(
                      "font-medium text-foreground",
                      columnHits.includes(column.name) && "rounded bg-primary/15 px-1",
                    )}
                  >
                    {column.name}
                  </code>
                  <span className="truncate text-muted-foreground" title={displayType(column.type)}>
                    {displayType(column.type)}
                    {column.nullable ? " · optional" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {table.foreignKeys.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Links to</p>
              <ul className="flex flex-wrap gap-1.5">
                {table.foreignKeys.map((fk) => (
                  <li key={`${fk.columns.join(",")}-${fk.table}`}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => onJump(fk.table)}
                    >
                      <code>{fk.columns.join(", ")}</code> → <code className="font-semibold">{fk.table}</code>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {table.referencedBy.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Referenced by
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {table.referencedBy.map((ref) => (
                  <li key={`${ref.table}-${ref.columns.join(",")}`}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => onJump(ref.table)}
                    >
                      <code className="font-semibold">{ref.table}</code>.<code>{ref.columns.join(", ")}</code>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function SchemaTreeView({ schema }: { schema: ParsedSchema }) {
  const tree = useMemo<SchemaTreeDomain[]>(() => buildSchemaTree(schema), [schema]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["root"]));
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const needle = query.trim().toLowerCase();
  const visibleTree = useMemo(
    () =>
      tree
        .map((domain) => ({ ...domain, tables: domain.tables.filter((table) => tableMatches(table, query)) }))
        .filter((domain) => domain.tables.length > 0),
    [tree, query],
  );
  const visibleFunctions = useMemo(
    () => schema.functions.filter((fn) => !needle || fn.name.toLowerCase().includes(needle)),
    [schema.functions, needle],
  );
  const visibleViews = useMemo(
    () => schema.views.filter((view) => !needle || view.name.toLowerCase().includes(needle)),
    [schema.views, needle],
  );
  const visibleEnums = useMemo(
    () =>
      schema.enums.filter(
        (en) => !needle || en.name.toLowerCase().includes(needle) || en.values.some((v) => v.toLowerCase().includes(needle)),
      ),
    [schema.enums, needle],
  );

  const tableCount = tree.reduce((sum, domain) => sum + domain.tables.length, 0);
  const columnCount = schema.tables.reduce((sum, table) => sum + table.columns.length, 0);
  const linkCount = schema.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0);

  const isOpen = (id: string) => (searching && id.startsWith("d:")) || expanded.has(id);
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const jumpTo = (tableName: string) => {
    const domain = tree.find((d) => d.tables.some((t) => t.name === tableName));
    if (!domain) return;
    if (searching && !tableMatches(domain.tables.find((t) => t.name === tableName)!, query)) setQuery("");
    setExpanded((previous) => new Set([...previous, "root", `d:${domain.id}`, `t:${tableName}`]));
    setScrollTarget(tableName);
  };

  useEffect(() => {
    if (!scrollTarget) return;
    const element = document.getElementById(`schema-table-${scrollTarget}`);
    element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    element?.querySelector("button")?.focus({ preventScroll: true });
    setScrollTarget(null);
  }, [scrollTarget]);

  const expandAll = () =>
    setExpanded(
      new Set(["root", ...tree.flatMap((d) => [`d:${d.id}`, ...d.tables.map((t) => `t:${t.name}`)])]),
    );
  const collapseAll = () => setExpanded(new Set(["root"]));

  const rootOpen = searching || expanded.has("root");

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/95">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/8 p-2.5 text-primary">
              <ListTree className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Schema Tree</h2>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                How Marshmallow's database is organised: business areas, their tables and columns, and how tables link to
                each other. Read from the generated database types, so it matches the schema at the last type
                regeneration. Read-only; who can see or change rows is decided by the database, not by this map.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Areas", tree.length],
              ["Tables", tableCount],
              ["Columns", columnCount],
              ["Links", linkCount],
              ["Functions", schema.functions.length],
              ["Enums", schema.enums.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tracking-tight text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search tables, columns, functions and enums"
                placeholder="Search tables, columns, functions, enums…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={expandAll}>
                Expand all
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={collapseAll}>
                Collapse all
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/95">
        <CardContent className="p-3 sm:p-5">
          <TreeToggle expanded={rootOpen} onToggle={() => toggle("root")} controls="schema-root" className="font-semibold">
            <span className="flex items-center gap-2 text-[14px]">
              <Database aria-hidden="true" className="h-4 w-4 text-primary" />
              Marshmallow
              <Badge variant="secondary" className="text-[10px]">Supabase · public schema</Badge>
            </span>
          </TreeToggle>

          {rootOpen && (
            <ul id="schema-root" className="ml-4 mt-1 space-y-1 border-l border-border/60 pl-3">
              {visibleTree.map((domain) => {
                const domainId = `d:${domain.id}`;
                const open = isOpen(domainId);
                return (
                  <li key={domain.id}>
                    <TreeToggle expanded={open} onToggle={() => toggle(domainId)} controls={`schema-domain-${domain.id}`}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-foreground">{domain.label}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {domain.tables.length} {domain.tables.length === 1 ? "table" : "tables"}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{domain.description}</span>
                    </TreeToggle>
                    {open && (
                      <ul id={`schema-domain-${domain.id}`} className="ml-4 space-y-0.5 border-l border-border/60 pl-3">
                        {domain.tables.map((table) => (
                          <TableNode
                            key={table.name}
                            table={table}
                            query={query}
                            expanded={expanded.has(`t:${table.name}`)}
                            onToggle={() => toggle(`t:${table.name}`)}
                            onJump={jumpTo}
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}

              {visibleViews.length > 0 && (
                <li>
                  <TreeToggle expanded={isOpen("s:views") || searching} onToggle={() => toggle("s:views")} controls="schema-views">
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      <Eye aria-hidden="true" className="h-4 w-4 text-primary" /> Views
                      <Badge variant="outline" className="text-[10px]">{visibleViews.length}</Badge>
                    </span>
                  </TreeToggle>
                  {(isOpen("s:views") || searching) && (
                    <ul id="schema-views" className="ml-6 space-y-1 border-l border-border/60 py-1 pl-4 text-[12px]">
                      {visibleViews.map((view) => (
                        <li key={view.name}>
                          <code className="font-semibold">{view.name}</code>
                          <span className="text-muted-foreground"> · {view.columns.map((c) => c.name).join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}

              {visibleFunctions.length > 0 && (
                <li>
                  <TreeToggle
                    expanded={isOpen("s:functions") || searching}
                    onToggle={() => toggle("s:functions")}
                    controls="schema-functions"
                  >
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      <FunctionSquare aria-hidden="true" className="h-4 w-4 text-primary" /> Database functions (RPC)
                      <Badge variant="outline" className="text-[10px]">{visibleFunctions.length}</Badge>
                    </span>
                    <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">
                      Server-side functions; approvals and other checked actions run here, never as direct client writes.
                    </span>
                  </TreeToggle>
                  {(isOpen("s:functions") || searching) && (
                    <ul id="schema-functions" className="ml-6 grid gap-x-6 gap-y-0.5 border-l border-border/60 py-1 pl-4 text-[12px] md:grid-cols-2">
                      {visibleFunctions.map((fn) => (
                        <li key={fn.name} className="min-w-0 truncate" title={`${fn.name}(${fn.args.join(", ")})`}>
                          <code className="font-semibold">{fn.name}</code>
                          <span className="text-muted-foreground">({fn.args.join(", ")})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}

              {visibleEnums.length > 0 && (
                <li>
                  <TreeToggle expanded={isOpen("s:enums") || searching} onToggle={() => toggle("s:enums")} controls="schema-enums">
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      <ListTree aria-hidden="true" className="h-4 w-4 text-primary" /> Enums
                      <Badge variant="outline" className="text-[10px]">{visibleEnums.length}</Badge>
                    </span>
                  </TreeToggle>
                  {(isOpen("s:enums") || searching) && (
                    <ul id="schema-enums" className="ml-6 space-y-1 border-l border-border/60 py-1 pl-4 text-[12px]">
                      {visibleEnums.map((en) => (
                        <li key={en.name}>
                          <code className="font-semibold">{en.name}</code>
                          <span className="text-muted-foreground"> · {en.values.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}

              {searching && visibleTree.length === 0 && visibleFunctions.length === 0 && visibleViews.length === 0 && visibleEnums.length === 0 && (
                <li className="px-2 py-3 text-[13px] text-muted-foreground">Nothing matches “{query.trim()}”.</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const parsedSchema = parseSupabaseTypes(typesSource);

export default function SchemaTreeTab() {
  return <SchemaTreeView schema={parsedSchema} />;
}
