/**
 * A small force-directed layout (the physics behind an Obsidian-style graph),
 * written here so the app does not need a graph library.
 *
 * Nodes push each other apart, links pull their ends together, and a weak
 * pull keeps everything near the centre. Positions start on a deterministic
 * spiral, so the same graph always settles the same way.
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual radius; also used to stop dots overlapping. */
  r: number;
  /** While set (e.g. being dragged) the node stays where it is put. */
  fixed?: boolean;
}

export interface LayoutLink {
  source: string;
  target: string;
  /** Preferred length of this link. */
  length?: number;
}

export interface LayoutOptions {
  repulsion?: number;
  springStrength?: number;
  linkLength?: number;
  gravity?: number;
  velocityDecay?: number;
}

export interface Layout {
  nodes: LayoutNode[];
  links: Array<{ source: LayoutNode; target: LayoutNode; length: number }>;
  options: Required<LayoutOptions>;
  alpha: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  repulsion: 1800,
  springStrength: 0.06,
  linkLength: 70,
  gravity: 0.035,
  velocityDecay: 0.55,
};

export function createLayout(
  nodes: Array<{ id: string; r: number }>,
  links: LayoutLink[],
  options: LayoutOptions = {},
): Layout {
  const merged = { ...DEFAULTS, ...options };
  // Phyllotaxis spiral: evenly spread, deterministic starting points.
  const layoutNodes = nodes.map((node, index) => {
    const radius = 12 * Math.sqrt(index + 0.5);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return { id: node.id, r: node.r, x: radius * Math.cos(angle), y: radius * Math.sin(angle), vx: 0, vy: 0 };
  });
  const byId = new Map(layoutNodes.map((node) => [node.id, node]));
  const layoutLinks = links
    .filter((link) => byId.has(link.source) && byId.has(link.target))
    .map((link) => ({ source: byId.get(link.source)!, target: byId.get(link.target)!, length: link.length ?? merged.linkLength }));
  return { nodes: layoutNodes, links: layoutLinks, options: merged, alpha: 1 };
}

/** Advances the simulation one step. Returns the new alpha (how much is still moving). */
export function tick(layout: Layout, alphaDecay = 0.02): number {
  const { nodes, links, options } = layout;
  const alpha = layout.alpha;

  // Repulsion between every pair (fine for a graph of ~100 dots).
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 0.01) {
        // Identical positions: nudge apart deterministically.
        dx = (i - j) * 0.1;
        dy = 0.1;
        distanceSq = dx * dx + dy * dy;
      }
      const distance = Math.sqrt(distanceSq);
      const minimum = a.r + b.r + 6;
      // Bigger (more connected) dots push harder, so busy hubs keep room for their labels.
      const weight = (a.r + b.r) / 14;
      let force = (options.repulsion * weight * alpha) / Math.max(distanceSq, 25);
      if (distance < minimum) force += (minimum - distance) * 0.5;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Springs along links.
  for (const link of links) {
    const dx = link.target.x - link.source.x;
    const dy = link.target.y - link.source.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (distance - link.length) * options.springStrength * alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    link.source.vx += fx;
    link.source.vy += fy;
    link.target.vx -= fx;
    link.target.vy -= fy;
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx -= node.x * options.gravity * alpha;
    node.vy -= node.y * options.gravity * alpha;
    node.vx *= options.velocityDecay;
    node.vy *= options.velocityDecay;
    node.x += node.vx;
    node.y += node.vy;
  }

  layout.alpha = Math.max(0, alpha - alphaDecay * alpha);
  return layout.alpha;
}

/** Runs the simulation until it has mostly settled (or `maxTicks` steps). */
export function settle(layout: Layout, maxTicks = 400, minAlpha = 0.005): Layout {
  for (let i = 0; i < maxTicks && layout.alpha > minAlpha; i++) tick(layout);
  return layout;
}

/** Wakes the simulation up again (after a drag) without restarting from scratch. */
export function reheat(layout: Layout, alpha = 0.3) {
  layout.alpha = Math.max(layout.alpha, alpha);
}

/** The box that holds every node, with padding. */
export function bounds(layout: Layout, padding = 40) {
  const xs = layout.nodes.map((n) => n.x);
  const ys = layout.nodes.map((n) => n.y);
  if (xs.length === 0) return { minX: -100, minY: -100, width: 200, height: 200 };
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return { minX, minY, width: Math.max(...xs) + padding - minX, height: Math.max(...ys) + padding - minY };
}
