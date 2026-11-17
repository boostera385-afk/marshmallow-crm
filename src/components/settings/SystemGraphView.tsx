import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { bounds, createLayout, reheat, settle, tick, type Layout } from "@/lib/force-layout";
import {
  EDGE_KIND_INFO,
  NODE_KIND_INFO,
  buildSystemGraph,
  describeConnections,
  type GraphEdgeKind,
  type GraphNodeFull,
} from "@/lib/system-graph";

const GRAPH = buildSystemGraph();
const NODE_BY_ID = new Map(GRAPH.nodes.map((node) => [node.id, node]));
const EDGE_KINDS = Object.keys(EDGE_KIND_INFO) as GraphEdgeKind[];
/** The kinds the legend offers as filters ("Part of" links only hold the screens together). */
const FILTER_KINDS = EDGE_KINDS.filter((kind) => kind !== "contains");

const DEGREE = new Map<string, number>();
GRAPH.edges.forEach((edge) => {
  DEGREE.set(edge.source, (DEGREE.get(edge.source) ?? 0) + 1);
  DEGREE.set(edge.target, (DEGREE.get(edge.target) ?? 0) + 1);
});

const NEIGHBOURS = new Map<string, Set<string>>();
GRAPH.edges.forEach((edge) => {
  if (!NEIGHBOURS.has(edge.source)) NEIGHBOURS.set(edge.source, new Set());
  if (!NEIGHBOURS.has(edge.target)) NEIGHBOURS.set(edge.target, new Set());
  NEIGHBOURS.get(edge.source)!.add(edge.target);
  NEIGHBOURS.get(edge.target)!.add(edge.source);
});

function radiusOf(node: GraphNodeFull): number {
  const base = node.kind === "app" ? 11 : node.kind === "service" || node.kind === "data" ? 9 : 5;
  return base + Math.min(9, Math.sqrt(DEGREE.get(node.id) ?? 0) * 1.6);
}

/** Lays the graph out once; the same input always settles to the same picture. */
function buildLayout(): Layout {
  const layout = createLayout(
    GRAPH.nodes.map((node) => ({ id: node.id, r: radiusOf(node) })),
    GRAPH.edges.map((edge) => ({ source: edge.source, target: edge.target, length: edge.kind === "contains" ? 80 : 140 })),
    { repulsion: 9000, springStrength: 0.04, gravity: 0.012 },
  );
  return settle(layout, 500);
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export default function SystemGraphView() {
  const layout = useMemo(buildLayout, []);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [view, setView] = useState<View>({ x: 450, y: 310, k: 1 });
  const [, setFrame] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<GraphEdgeKind>>(() => new Set(EDGE_KINDS));
  const [query, setQuery] = useState("");
  const animation = useRef<number | null>(null);
  const fitted = useRef(false);

  // ---------- sizing and "fit to screen" ----------
  const fit = useCallback(
    (width = size.width, height = size.height) => {
      const box = bounds(layout, 30);
      const k = clampZoom(Math.min(width / box.width, height / box.height));
      setView({ k, x: width / 2 - (box.minX + box.width / 2) * k, y: height / 2 - (box.minY + box.height / 2) * k });
    },
    [layout, size.width, size.height],
  );

  useEffect(() => {
    const element = svgRef.current?.parentElement;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width < 10 || height < 10) return;
      setSize({ width, height });
      if (!fitted.current) {
        fitted.current = true;
        fit(width, height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  // ---------- simulation loop (only while something is moving) ----------
  const run = useCallback(() => {
    if (animation.current != null || typeof requestAnimationFrame === "undefined") return;
    const step = () => {
      const alpha = tick(layout);
      setFrame((frame) => frame + 1);
      animation.current = alpha > 0.01 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, [layout]);

  useEffect(
    () => () => {
      if (animation.current != null) cancelAnimationFrame(animation.current);
    },
    [],
  );

  // ---------- coordinates ----------
  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return { x: (clientX - left - view.x) / view.k, y: (clientY - top - view.y) / view.k };
    },
    [view],
  );

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((current) => {
      const k = clampZoom(current.k * factor);
      const ratio = k / current.k;
      return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  }, []);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---------- pointer: pan, pinch, drag ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { type: "pan"; startX: number; startY: number; viewX: number; viewY: number }
    | { type: "drag"; id: string; moved: boolean; startX: number; startY: number }
    | { type: "pinch"; distance: number; k: number }
    | null
  >(null);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.target as Element).setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      return;
    }
    const nodeId = (event.target as Element).closest?.("[data-node-id]")?.getAttribute("data-node-id");
    if (nodeId) {
      gesture.current = { type: "drag", id: nodeId, moved: false, startX: event.clientX, startY: event.clientY };
    } else {
      gesture.current = { type: "pan", startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.type === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = svgRef.current?.getBoundingClientRect();
      const k = clampZoom((current.k * Math.hypot(a.x - b.x, a.y - b.y)) / current.distance);
      zoomAt(k / view.k, (a.x + b.x) / 2 - (rect?.left ?? 0), (a.y + b.y) / 2 - (rect?.top ?? 0));
    } else if (current.type === "pan") {
      setView((v) => ({ ...v, x: current.viewX + event.clientX - current.startX, y: current.viewY + event.clientY - current.startY }));
    } else if (current.type === "drag") {
      if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
      current.moved = true;
      const node = positions.get(current.id);
      if (!node) return;
      const point = toGraph(event.clientX, event.clientY);
      node.fixed = true;
      node.x = point.x;
      node.y = point.y;
      reheat(layout, 0.25);
      run();
      setFrame((frame) => frame + 1);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (current?.type === "drag") {
      const node = positions.get(current.id);
      if (node) node.fixed = false;
      if (!current.moved) setSelected((previous) => (previous === current.id ? null : current.id));
    } else if (current?.type === "pan" && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) {
      setSelected(null);
    }
    // Lifting any finger ends the gesture; a finger left over from a pinch does not start a pan.
    gesture.current = null;
  };

  // ---------- highlighting ----------
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? new Set(GRAPH.nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.description.toLowerCase().includes(needle)).map((n) => n.id)) : null),
    [needle],
  );
  const visibleEdges = useMemo(() => GRAPH.edges.filter((edge) => enabled.has(edge.kind)), [enabled]);
  const filtering = enabled.size < EDGE_KINDS.length;
  const nodesWithVisibleEdges = useMemo(() => {
    const set = new Set<string>();
    visibleEdges.filter((edge) => edge.kind !== "contains").forEach((edge) => {
      set.add(edge.source);
      set.add(edge.target);
    });
    return set;
  }, [visibleEdges]);

  const focusId = hovered ?? selected;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const set = new Set([focusId]);
    visibleEdges.forEach((edge) => {
      if (edge.source === focusId) set.add(edge.target);
      if (edge.target === focusId) set.add(edge.source);
    });
    return set;
  }, [focusId, visibleEdges]);

  const nodeDimmed = (id: string) => {
    if (focusSet) return !focusSet.has(id);
    if (matches) return !matches.has(id);
    if (filtering) return !nodesWithVisibleEdges.has(id);
    return false;
  };

  const centreOn = (id: string) => {
    const node = positions.get(id);
    if (!node) return;
    setView((v) => ({ ...v, x: size.width / 2 - node.x * v.k, y: size.height / 2 - node.y * v.k }));
  };

  const select = (id: string) => {
    setSelected(id);
    centreOn(id);
  };

  const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected((previous) => (previous === id ? null : id));
    }
    if (event.key === "Escape") setSelected(null);
  };

  const toggleKind = (kind: GraphEdgeKind) =>
    setEnabled((previous) => {
      // First click on a full legend shows only that kind, which is what people want ("show me where AI is used").
      if (previous.size === EDGE_KINDS.length) return new Set<GraphEdgeKind>([kind]);
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      if (next.size === 0) return new Set(EDGE_KINDS);
      return next;
    });

  const selectedNode = selected ? NODE_BY_ID.get(selected) ?? null : null;
  const connections = useMemo(() => (selected ? describeConnections(GRAPH, selected) : []), [selected]);
  const showAllLabels = view.k >= 1.5;

  return (
    <div className="space-y-3">
      {/* Legend: line colours are also filters */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show connections">
        {FILTER_KINDS.map((kind) => {
          const on = enabled.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={filtering ? on : false}
              onClick={() => toggleKind(kind)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filtering && on ? "border-foreground/30 bg-muted text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted/60",
                filtering && !on && "opacity-50",
              )}
            >
              <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ backgroundColor: EDGE_KIND_INFO[kind].color }} />
              {EDGE_KIND_INFO[kind].label}
            </button>
          );
        })}
        {filtering && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-[11.5px]" onClick={() => setEnabled(new Set(EDGE_KINDS))}>
            Show all
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <div className="relative h-[460px] overflow-hidden rounded-xl border border-border/60 bg-[radial-gradient(circle_at_center,hsl(var(--muted)/0.55),hsl(var(--card)))] sm:h-[620px]">
            <svg
              ref={svgRef}
              role="img"
              aria-label="Marshmallow connection graph"
              width="100%"
              height="100%"
              className="touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHovered(null)}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {visibleEdges.map((edge) => {
                  const source = positions.get(edge.source);
                  const target = positions.get(edge.target);
                  if (!source || !target) return null;
                  const lit = focusId != null && (edge.source === focusId || edge.target === focusId);
                  const faded = (focusId != null && !lit) || (matches != null && !matches.has(edge.source) && !matches.has(edge.target));
                  return (
                    <line
                      key={`${edge.source}|${edge.target}|${edge.kind}`}
                      data-edge-kind={edge.kind}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={EDGE_KIND_INFO[edge.kind].color}
                      strokeWidth={(lit ? 2.2 : edge.kind === "contains" ? 0.8 : 1.3) / Math.sqrt(view.k)}
                      strokeOpacity={faded ? 0.07 : lit ? 0.95 : edge.kind === "contains" ? 0.35 : 0.55}
                    />
                  );
                })}
                {GRAPH.nodes.map((node) => {
                  const position = positions.get(node.id)!;
                  const r = position.r;
                  const dim = nodeDimmed(node.id);
                  const isSelected = selected === node.id;
                  const isMatch = matches?.has(node.id);
                  const big = node.kind !== "screen" && node.kind !== "function";
                  const labelled = showAllLabels || big || (focusSet?.has(node.id) ?? false) || isMatch || (filtering && !dim && !focusSet);
                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.label}, ${NODE_KIND_INFO[node.kind].label}`}
                      aria-pressed={isSelected}
                      transform={`translate(${position.x},${position.y})`}
                      className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-[hsl(var(--ring))]"
                      opacity={dim ? 0.18 : 1}
                      onPointerEnter={() => setHovered(node.id)}
                      onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
                      onFocus={() => setHovered(node.id)}
                      onBlur={() => setHovered((h) => (h === node.id ? null : h))}
                      onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                    >
                      <circle
                        r={r + (isSelected || isMatch ? 4 : 2.5)}
                        fill="none"
                        stroke={isSelected ? "hsl(var(--foreground))" : isMatch ? NODE_KIND_INFO[node.kind].color : "transparent"}
                        strokeWidth={1.5 / Math.sqrt(view.k)}
                      />
                      <circle r={r} fill={NODE_KIND_INFO[node.kind].color} stroke="hsl(var(--card))" strokeWidth={1.5} />
                      {labelled && (
                        <text
                          y={r + 11 / Math.sqrt(view.k)}
                          textAnchor="middle"
                          className="pointer-events-none fill-foreground"
                          style={{
                            fontSize: `${(big ? 12 : 10.5) / Math.sqrt(view.k)}px`,
                            fontWeight: big ? 600 : 500,
                            paintOrder: "stroke",
                            stroke: "hsl(var(--card))",
                            strokeWidth: 3 / Math.sqrt(view.k),
                          }}
                        >
                          {node.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Search and zoom controls float over the graph */}
            <div className="absolute left-2 right-2 top-2 flex items-center gap-2 sm:left-3 sm:right-auto sm:w-72">
              <div className="relative flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Find in the graph"
                  placeholder="Find: openai, leads, webhook…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && matches?.size) select([...matches][0]);
                  }}
                  className="h-8 bg-card/90 pl-8 text-[12px] backdrop-blur"
                />
              </div>
              {matches && <span className="shrink-0 rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">{matches.size} found</span>}
            </div>
            <div className="absolute bottom-2 right-2 flex flex-col gap-1">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8 bg-card/90" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.width / 2, size.height / 2)}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8 bg-card/90" aria-label="Zoom out" onClick={() => zoomAt(0.8, size.width / 2, size.height / 2)}>
                <Minus className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8 bg-card/90" aria-label="Fit graph to view" onClick={() => fit()}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="pointer-events-none absolute bottom-2 left-2 hidden flex-wrap gap-x-3 gap-y-1 rounded-md bg-card/85 px-2 py-1 text-[10.5px] text-muted-foreground backdrop-blur sm:flex">
              {Object.entries(NODE_KIND_INFO).map(([kind, info]) => (
                <span key={kind} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: info.color }} />
                  {info.label}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Drag to move around, scroll or pinch to zoom, drag a dot to pull it. Click a dot to see what it is connected to.</p>
        </div>

        {/* Details panel */}
        <aside
          aria-label="Selected item"
          aria-live="polite"
          className="w-full shrink-0 rounded-xl border border-border/60 bg-card p-4 lg:w-80"
        >
          {selectedNode ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: NODE_KIND_INFO[selectedNode.kind].color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{NODE_KIND_INFO[selectedNode.kind].label}</p>
                  <h3 className={cn("break-words text-[15px] font-semibold text-foreground", selectedNode.kind === "function" && "font-mono text-[13.5px]")}>{selectedNode.label}</h3>
                </div>
                <button type="button" aria-label="Close details" onClick={() => setSelected(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[12.5px] leading-relaxed text-foreground/85">{selectedNode.description}</p>
              {selectedNode.facts.length > 0 && (
                <ul className="space-y-0.5 text-[12px] text-muted-foreground">
                  {selectedNode.facts.map((fact) => (
                    <li key={fact}>• {fact}</li>
                  ))}
                </ul>
              )}
              <div className="space-y-2.5 border-t border-border/60 pt-3">
                {connections.map((group) => (
                  <div key={`${group.kind}-${group.heading}`}>
                    <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground">
                      <span aria-hidden="true" className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: EDGE_KIND_INFO[group.kind].color }} />
                      {group.heading}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {group.nodeIds.map((id) => {
                        const other = NODE_BY_ID.get(id);
                        if (!other) return null;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => select(id)}
                            className={cn(
                              "rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              other.kind === "function" && "font-mono",
                            )}
                          >
                            {other.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-[12.5px] text-muted-foreground">
              <p className="font-semibold text-foreground">Click any dot</p>
              <p>See what it is and everything it connects to: where AI is used, where the Quo API is called, which functions receive webhooks, and what touches leads.</p>
              <p>Use the coloured buttons above to show one kind of connection, for example only <span className="font-medium" style={{ color: EDGE_KIND_INFO.ai.color }}>AI used here</span>.</p>
              <label className="block pt-1 text-[11px] font-semibold uppercase tracking-[0.1em]" htmlFor="graph-jump">Or jump to</label>
              <select
                id="graph-jump"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px] text-foreground"
                value=""
                onChange={(event) => event.target.value && select(event.target.value)}
              >
                <option value="">Choose an item…</option>
                {(Object.keys(NODE_KIND_INFO) as Array<keyof typeof NODE_KIND_INFO>).map((kind) => (
                  <optgroup key={kind} label={NODE_KIND_INFO[kind].label}>
                    {GRAPH.nodes.filter((n) => n.kind === kind).map((n) => (
                      <option key={n.id} value={n.id}>{n.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
