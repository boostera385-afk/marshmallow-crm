import { useMemo, useState } from "react";
import { ChevronDown, Cloud, FolderTree, LayoutDashboard, Puzzle, Route, Search, Server, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  branchIds,
  buildStructureTree,
  filterStructureTree,
  type StructureNode,
  type StructureNodeKind,
} from "@/lib/app-structure";

/** Each top-level branch gets its own colour, like the columns of an org chart. */
const BRANCH_STYLE: Record<string, { icon: LucideIcon; header: string; card: string; accent: string }> = {
  journey: {
    icon: Route,
    header: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-50",
    card: "border-amber-200 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-400/[0.07]",
    accent: "border-l-amber-400",
  },
  screens: {
    icon: LayoutDashboard,
    header: "border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-400/40 dark:bg-violet-400/15 dark:text-violet-50",
    card: "border-violet-200 bg-violet-50 dark:border-violet-400/25 dark:bg-violet-400/[0.07]",
    accent: "border-l-violet-400",
  },
  edge: {
    icon: Server,
    header: "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-sky-50",
    card: "border-sky-200 bg-sky-50 dark:border-sky-400/25 dark:bg-sky-400/[0.07]",
    accent: "border-l-sky-400",
  },
  donut: {
    icon: Puzzle,
    header: "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-50",
    card: "border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-400/[0.07]",
    accent: "border-l-emerald-400",
  },
  services: {
    icon: Cloud,
    header: "border-rose-300 bg-rose-100 text-rose-950 dark:border-rose-400/40 dark:bg-rose-400/15 dark:text-rose-50",
    card: "border-rose-200 bg-rose-50 dark:border-rose-400/25 dark:bg-rose-400/[0.07]",
    accent: "border-l-rose-400",
  },
};

/** Small facts (a role, a status, a caller…) are drawn as compact boxes with a caption. */
const COMPACT_KINDS = new Set<StructureNodeKind>(["role", "status", "caller", "target", "note"]);

const LINE = "bg-border";

function NodeBox({
  node,
  branch,
  depth,
  isLast,
  expanded,
  onToggle,
}: {
  node: StructureNode;
  branch: (typeof BRANCH_STYLE)[string];
  depth: number;
  isLast: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const open = hasChildren && expanded.has(node.id);
  const compact = COMPACT_KINDS.has(node.kind);
  const listId = `structure-node-${node.id}`;

  const box = (
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          {compact && node.detail && (
            <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{node.detail}</span>
          )}
          <span
            className={cn(
              "block break-words",
              node.kind === "function" || node.kind === "target" ? "font-mono text-[11.5px]" : "text-[12.5px]",
              node.kind === "group" ? "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" : "font-semibold text-foreground",
              compact && "font-medium",
            )}
          >
            {node.label}
          </span>
          {!compact && node.detail && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{node.detail}</span>}
        </span>
        {hasChildren && (
          <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[10.5px] font-medium text-muted-foreground">
            {children.length}
            <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
          </span>
        )}
      </span>
  );

  const boxClass = cn(
    "block w-full rounded-md border px-2.5 py-1.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    depth === 0 ? branch.card : "border-border/70 bg-card",
    depth > 0 && "border-l-[3px]",
    depth > 0 && branch.accent,
    compact && "py-1",
  );

  return (
    <li className="relative pl-5">
      {/* Org-chart connector: rail from the parent and an elbow into this box. */}
      <span aria-hidden="true" className={cn("absolute left-2 top-0 w-px", LINE, isLast ? "h-[18px]" : "h-full")} />
      <span aria-hidden="true" className={cn("absolute left-2 top-[18px] h-px w-3", LINE)} />
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onToggle(node.id)}
          className={cn(boxClass, "transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {box}
        </button>
      ) : (
        <div className={boxClass}>{box}</div>
      )}
      {open && <Stack id={listId} nodes={children} branch={branch} depth={depth + 1} expanded={expanded} onToggle={onToggle} />}
    </li>
  );
}

function Stack({
  id,
  nodes,
  branch,
  depth,
  expanded,
  onToggle,
}: {
  id: string;
  nodes: StructureNode[];
  branch: (typeof BRANCH_STYLE)[string];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul id={id} className={cn("mt-2 space-y-2", depth > 0 && "ml-2")}>
      {nodes.map((node, index) => (
        <NodeBox key={node.id} node={node} branch={branch} depth={depth} isLast={index === nodes.length - 1} expanded={expanded} onToggle={onToggle} />
      ))}
    </ul>
  );
}

const FULL_TREE = buildStructureTree();
const BRANCH_IDS = (FULL_TREE.children ?? []).map((branch) => branch.id);
const DEFAULT_EXPANDED = new Set(["root", ...BRANCH_IDS]);

function findNode(node: StructureNode, id: string): StructureNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function nodeMatches(node: StructureNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return node.label.toLowerCase().includes(needle) || (node.detail ?? "").toLowerCase().includes(needle);
}

export default function StructureTab() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(DEFAULT_EXPANDED);

  const searching = query.trim().length > 0;
  const tree = useMemo(() => filterStructureTree(FULL_TREE, query), [query]);
  // While searching, every box on the way to a match is open; a match opens on click.
  const pathToMatches = useMemo(
    () => (searching && tree ? branchIds(tree).filter((id) => BRANCH_IDS.includes(id) || id === "root" || !nodeMatches(findNode(tree, id)!, query)) : []),
    [searching, tree, query],
  );
  const shown = useMemo(() => new Set([...pathToMatches, ...expanded]), [pathToMatches, expanded]);
  const forced = useMemo(() => new Set(pathToMatches), [pathToMatches]);

  const toggle = (id: string) => {
    if (forced.has(id)) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const branches = tree?.children ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/95">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/8 p-2.5 text-primary">
              <FolderTree className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Marshmallow Structure</h2>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Marshmallow as an org chart: the lead journey, every CRM screen and who opens it, the Edge Functions
                behind them, what Donut does, and the outside services. Click a box to open what is under it. Default
                roles are read from the app's access rules; per-user grants in Feature Access can add more. Read-only.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search the Marshmallow structure"
                placeholder="Search screens, roles, functions, statuses…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set(branchIds(FULL_TREE)))}>
                Expand all
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set(DEFAULT_EXPANDED))}>
                Collapse all
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/95">
        <CardContent className="p-0">
          {tree ? (
            <div className="max-w-full overflow-x-auto" role="region" aria-label="Marshmallow org chart" tabIndex={0}>
              <div className="min-w-[1180px] px-5 pb-6 pt-6">
                {/* Root box */}
                <div className="flex flex-col items-center">
                  <div className="rounded-lg border-2 border-primary/40 bg-primary/[0.08] px-6 py-2.5 text-center shadow-sm">
                    <p className="text-[16px] font-bold tracking-tight text-foreground">{tree.label}</p>
                    {tree.detail && <p className="text-[11px] text-muted-foreground">{tree.detail}</p>}
                  </div>
                  <span aria-hidden="true" className={cn("h-6 w-px", LINE)} />
                </div>

                {/* One column per branch, joined by a horizontal bar */}
                <ol className="grid gap-x-4" style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }}>
                  {branches.map((branch, index) => {
                    const style = BRANCH_STYLE[branch.id] ?? BRANCH_STYLE.journey;
                    const Icon = style.icon;
                    const open = shown.has(branch.id);
                    const listId = `structure-node-${branch.id}`;
                    return (
                      <li key={branch.id} className="relative pt-6">
                        {branches.length > 1 && (
                          <span
                            aria-hidden="true"
                            className={cn("absolute top-0 h-px", LINE)}
                            style={{
                              left: index === 0 ? "50%" : "-0.5rem",
                              right: index === branches.length - 1 ? "50%" : "-0.5rem",
                            }}
                          />
                        )}
                        <span aria-hidden="true" className={cn("absolute left-1/2 top-0 h-6 w-px", LINE)} />
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={listId}
                          onClick={() => toggle(branch.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg border-2 px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            style.header,
                          )}
                        >
                          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-bold leading-tight">{branch.label}</span>
                            {branch.detail && <span className="block text-[11px] leading-snug opacity-75">{branch.detail}</span>}
                          </span>
                          <span className="flex items-center gap-0.5 text-[11px] font-semibold opacity-75">
                            {branch.children?.length ?? 0}
                            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
                          </span>
                        </button>
                        {open && branch.children && (
                          <Stack id={listId} nodes={branch.children} branch={style} depth={0} expanded={shown} onToggle={toggle} />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted-foreground">Nothing matches “{query.trim()}”.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
