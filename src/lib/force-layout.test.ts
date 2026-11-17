import { describe, expect, it } from "vitest";
import { bounds, createLayout, reheat, settle, tick } from "@/lib/force-layout";

const star = () =>
  createLayout(
    [{ id: "hub", r: 12 }, ...Array.from({ length: 8 }, (_, i) => ({ id: `leaf${i}`, r: 5 })), { id: "loner", r: 5 }],
    Array.from({ length: 8 }, (_, i) => ({ source: "hub", target: `leaf${i}`, length: 60 })),
  );

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("force layout", () => {
  it("is deterministic: the same graph settles to the same positions", () => {
    const a = settle(star());
    const b = settle(star());
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
  });

  it("pulls linked dots towards their link length and keeps dots from overlapping", () => {
    const layout = settle(star(), 600);
    const hub = layout.nodes[0];
    layout.nodes.slice(1, 9).forEach((leaf) => expect(distance(hub, leaf)).toBeGreaterThan(30));
    layout.nodes.slice(1, 9).forEach((leaf) => expect(distance(hub, leaf)).toBeLessThan(200));
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        expect(distance(a, b)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it("cools down, and a reheat after a drag moves the others but not the held dot", () => {
    const layout = settle(star());
    expect(layout.alpha).toBeLessThan(0.01);
    const held = layout.nodes[1];
    held.fixed = true;
    held.x = 400;
    held.y = 400;
    const hubBefore = { x: layout.nodes[0].x, y: layout.nodes[0].y };
    reheat(layout, 0.3);
    for (let i = 0; i < 30; i++) tick(layout);
    expect(held.x).toBe(400);
    expect(held.y).toBe(400);
    expect(distance(layout.nodes[0], hubBefore)).toBeGreaterThan(1);
  });

  it("ignores links to unknown dots and reports a padded bounding box", () => {
    const layout = createLayout([{ id: "a", r: 5 }], [{ source: "a", target: "missing" }]);
    expect(layout.links).toHaveLength(0);
    const box = bounds(layout, 10);
    expect(box.width).toBeGreaterThanOrEqual(20);
    expect(bounds(createLayout([], []))).toEqual({ minX: -100, minY: -100, width: 200, height: 200 });
  });
});
