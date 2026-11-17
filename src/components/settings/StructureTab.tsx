import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Building2,
  ChevronRight,
  Cloud,
  Cog,
  FolderTree,
  Globe,
  LayoutDashboard,
  ListChecks,
  Puzzle,
  Route,
  Search,
  Server,
  Tag,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
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

const BRANCH_ICONS: Record<string, LucideIcon> = {
  journey: Route,
  screens: LayoutDashboard,
  edge: Server,
  donut: Puzzle,
  services: Cloud,
};

const KIND_ICONS: Partial<Record<StructureNodeKind, LucideIcon>> = {
  root: Building2,
  group: FolderTree,
  step: ListChecks,
  screen: LayoutDashboard,
  function: Cog,
  capability: Puzzle,
  service: Globe,
  role: UserRound,
  status: Tag,
  caller: Workflow,
};

const LABEL_STYLE: Record<StructureNodeKind, string> = {
  root: "text-[15px] font-bold text-foreground",
  branch: "text-[14px] font-semibold text-foreground",
  group: "text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
  step: "text-[13px] font-semibold text-foreground",
  screen: "text-[13px] font-semibold text-foreground",
  function: "font-mono text-[12px] font-medium text-primary",
  capability: "text-[13px] font-semibold text-foreground",
  service: "text-[13px] font-semibold text-foreground",
  role: "text-[12px] font-medium text-foreground",
  status: "text-[12px] font-medium text-foreground",
  caller: "text-[12px] font-medium text-foreground",
  target: "font-mono text-[12px] text-foreground",
  note: "text-[12px] text-foreground/85",
};

/** Nodes shown in order, for keyboard movement. */
function visibleNodes(node: StructureNode, expanded: Set<string>, parentId: string | null, out: Array<{ node: StructureNode; parentId: string | null }> = []) {
  out.push({ node, parentId });
  if (node.children?.length && expanded.has(node.id)) node.children.forEach((child) => visibleNodes(child, expanded, node.id, out));
  return out;
}

function TreeNode({
  node,
  level,
  isLast,
  expanded,
  focusedId,
  onToggle,
  onFocusNode,
  onKeyDown,
  registerRef,
}: {
  node: StructureNode;
  level: number;
  isLast: boolean;
  expanded: Set<string>;
  focusedId: string;
  onToggle: (id: string) => void;
  onFocusNode: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: StructureNode) => void;
  registerRef: (id: string, element: HTMLDivElement | null) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const open = hasChildren && expanded.has(node.id);
  const Icon = (node.kind === "branch" ? BRANCH_ICONS[node.id] : KIND_ICONS[node.kind]) ?? null;
  const inlineDetail = node.kind === "role" || node.kind === "status" || node.kind === "caller" || node.kind === "target" || node.kind === "note";
  const groupId = `structure-children-${node.id}`;

  return (
    <li
      role="none"
      className={cn(
        "relative",
        // Connector lines: a vertical rail from the parent and an elbow into this node.
        level > 1 && [
          "pl-6",
          "before:absolute before:left-[9px] before:top-0 before:border-l before:border-border",
          isLast ? "before:h-[19px]" : "before:h-full",
          "after:absolute after:left-[9px] after:top-[19px] after:w-3.5 after:border-t after:border-border",
        ],
      )}
    >
      <div
        ref={(element) => registerRef(node.id, element)}
        role="treeitem"
        aria-level={level}
        aria-expanded={hasChildren ? open : undefined}
        aria-owns={open ? groupId : undefined}
        aria-label={node.detail && inlineDetail ? `${node.detail}: ${node.label}` : node.label}
        tabIndex={focusedId === node.id ? 0 : -1}
        onFocus={() => onFocusNode(node.id)}
        onClick={() => {
          onFocusNode(node.id);
          if (hasChildren) onToggle(node.id);
        }}
        onKeyDown={(event) => onKeyDown(event, node)}
        className={cn(
          "group flex min-h-[38px] cursor-default items-start gap-1.5 rounded-lg px-1.5 py-1.5 outline-none transition-colors",
          hasChildren && "cursor-pointer hover:bg-muted/50",
          "focus-visible:ring-2 focus-visible:ring-ring",
          node.kind === "root" && "bg-primary/[0.06]",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-[3px] h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !hasChildren && "invisible",
          )}
        />
        {Icon && (
          <Icon
            aria-hidden="true"
            className={cn("mt-[3px] h-4 w-4 shrink-0", node.kind === "root" || node.kind === "branch" ? "text-primary" : "text-muted-foreground")}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {node.detail && inlineDetail && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{node.detail}</span>
            )}
            <span className={cn("break-words", LABEL_STYLE[node.kind])}>{node.label}</span>
            {hasChildren && (
              <span className="text-[11px] text-muted-foreground">({node.children!.length})</span>
            )}
          </span>
          {node.detail && !inlineDetail && (
            <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{node.detail}</span>
          )}
        </span>
      </div>

      {open && (
        <ul role="group" id={groupId} className="relative">
          {node.children!.map((child, index) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              isLast={index === node.children!.length - 1}
              expanded={expanded}
              focusedId={focusedId}
              onToggle={onToggle}
              onFocusNode={onFocusNode}
              onKeyDown={onKeyDown}
              registerRef={registerRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const FULL_TREE = buildStructureTree();
const DEFAULT_EXPANDED = new Set(["root"]);

export default function StructureTab() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(DEFAULT_EXPANDED);
  const [focusedId, setFocusedId] = useState("root");
  const refs = useRef(new Map<string, HTMLDivElement>());

  const searching = query.trim().length > 0;
  const tree = useMemo(() => filterStructureTree(FULL_TREE, query), [query]);
  // While searching, every branch on the path to a match is open; a match
  // itself stays closed until clicked, like any other node.
  const pathToMatches = useMemo(
    () => (searching && tree ? branchIds(tree).filter((id) => id === "root" || !nodeMatches(findNode(tree, id)!, query)) : []),
    [searching, tree, query],
  );
  const shownExpanded = useMemo(() => new Set([...pathToMatches, ...expanded]), [pathToMatches, expanded]);
  const forcedOpen = useMemo(() => new Set(pathToMatches), [pathToMatches]);

  const toggle = (id: string) => {
    if (forcedOpen.has(id)) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const focusNode = (id: string) => {
    setFocusedId(id);
    refs.current.get(id)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: StructureNode) => {
    if (!tree) return;
    const order = visibleNodes(tree, shownExpanded, null);
    const index = order.findIndex((entry) => entry.node.id === node.id);
    const hasChildren = Boolean(node.children?.length);
    const open = shownExpanded.has(node.id);
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        if (index < order.length - 1) focusNode(order[index + 1].node.id);
        break;
      case "ArrowUp":
        if (index > 0) focusNode(order[index - 1].node.id);
        break;
      case "ArrowRight":
        if (hasChildren && !open) toggle(node.id);
        else if (hasChildren && open) focusNode(node.children![0].id);
        break;
      case "ArrowLeft":
        if (hasChildren && open && !forcedOpen.has(node.id)) toggle(node.id);
        else if (order[index]?.parentId) focusNode(order[index].parentId!);
        break;
      case "Home":
        focusNode(order[0].node.id);
        break;
      case "End":
        focusNode(order[order.length - 1].node.id);
        break;
      case "Enter":
      case " ":
        if (hasChildren) toggle(node.id);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const registerRef = (id: string, element: HTMLDivElement | null) => {
    if (element) refs.current.set(id, element);
    else refs.current.delete(id);
  };

  const rootFocusable = tree && findNode(tree, focusedId) ? focusedId : "root";

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
                Marshmallow as one tree: the lead journey, every CRM screen and who opens it, the Edge Functions behind
                them, what Donut does, and the outside services. Click a branch, or use the arrow keys, to open it.
                Default roles are read from the app's access rules; per-user grants in Feature Access can add more.
                Read-only.
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
        <CardContent className="overflow-x-hidden p-3 sm:p-5">
          {tree ? (
            <ul role="tree" aria-label="Marshmallow structure">
              <TreeNode
                node={tree}
                level={1}
                isLast
                expanded={shownExpanded}
                focusedId={rootFocusable}
                onToggle={toggle}
                onFocusNode={setFocusedId}
                onKeyDown={handleKeyDown}
                registerRef={registerRef}
              />
            </ul>
          ) : (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">Nothing matches “{query.trim()}”.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
