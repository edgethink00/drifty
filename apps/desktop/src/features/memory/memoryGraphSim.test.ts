import { describe, expect, it } from "vitest";
import { createSimulation, fitView, hold, letGo, viewPath, zoomAt } from "./memoryGraphSim";

const box = { width: 60, height: 50 };
function graph() {
  const homes = new Map([["a", { x: 100, y: 100 }], ["b", { x: 260, y: 100 }], ["c", { x: 100, y: 300 }]]);
  const boxes = new Map([...homes.keys()].map((id) => [id, box] as const));
  return createSimulation(homes, boxes, [{ source: "a", target: "b" }]);
}

describe("memory graph motion", () => {
  it("rests exactly at the layout with the simulation stopped", () => {
    const motion = graph();
    for (const node of motion.nodes) expect([node.x, node.y]).toEqual([node.homeX, node.homeY]);
    motion.simulation.tick(50);
    for (const node of motion.nodes) expect(Math.hypot(node.x - node.homeX, node.y - node.homeY)).toBeLessThan(0.01);
  });

  it("pulls a held page's neighbour along, leaves unlinked pages, keeps the drop and settles without swinging back past its home", () => {
    const motion = graph();
    const [a, b, c] = motion.nodes;
    for (let i = 0; i < 40; i += 1) { hold(motion, 0, 40, 220, true); motion.simulation.stop(); motion.simulation.tick(); }
    expect(Math.hypot(b.x - 260, b.y - 100)).toBeGreaterThan(5);
    expect(Math.hypot(c.x - 100, c.y - 300)).toBeLessThan(6);
    letGo(motion, 0, true);
    motion.simulation.stop();
    const away = { x: b.x - 260, y: b.y - 100 };
    const length = Math.hypot(away.x, away.y);
    let overshoot = 0;
    let last = { x: b.x, y: b.y };
    for (let i = 0; i < 300 && motion.simulation.alpha() >= motion.simulation.alphaMin(); i += 1) {
      motion.simulation.tick();
      overshoot = Math.max(overshoot, -((b.x - 260) * away.x + (b.y - 100) * away.y) / length);
      last = { x: b.x, y: b.y };
    }
    // It heads back towards where it was and never passes it: no spring.
    expect(overshoot).toBeLessThan(0.5);
    expect(Math.hypot(last.x - 260, last.y - 100)).toBeLessThan(length);
    expect(Math.hypot(a.x - 40, a.y - 220)).toBeLessThan(0.5);
    // Where it stopped is now its place.
    motion.simulation.on("end.rest")?.call(motion.simulation);
    expect([b.homeX, b.homeY]).toEqual([b.x, b.y]);
  });

  it("moves only the held page when motion is reduced", () => {
    const motion = graph();
    const [, b] = motion.nodes;
    hold(motion, 0, 40, 220, false);
    letGo(motion, 0, false);
    expect([motion.nodes[0].x, motion.nodes[0].y]).toEqual([40, 220]);
    expect([b.x, b.y]).toEqual([260, 100]);
  });

  it("fits every page in view without enlarging past the cap and zooms around the pointer", () => {
    const nodes = [{ x: 0, y: 0, width: 40, height: 40 }, { x: 400, y: 200, width: 40, height: 40 }];
    const view = fitView(nodes, 800, 600, 48, 1.15);
    expect(view.k).toBe(1.15);
    expect(view.tx + 200 * view.k).toBeCloseTo(400);
    expect(view.ty + 100 * view.k).toBeCloseTo(300);
    const tight = fitView(nodes, 300, 300, 48, 1.15);
    expect(tight.k).toBeLessThan(1);
    const zoomed = zoomAt(view, 2, 120, 80);
    expect((120 - view.tx) / view.k).toBeCloseTo((120 - zoomed.tx) / zoomed.k);
    expect((80 - view.ty) / view.k).toBeCloseTo((80 - zoomed.ty) / zoomed.k);
  });

  it("glides between views along d3's zoom path and ends exactly on the target", () => {
    const from = { k: 1, tx: 0, ty: 0 }; const to = { k: 0.8, tx: -120, ty: 40 };
    const path = viewPath(from, to, 800, 600);
    expect(path.duration).toBeGreaterThan(0);
    expect(path.at(0).k).toBeCloseTo(1);
    expect(path.at(0).tx).toBeCloseTo(0);
    expect(path.at(1)).toEqual(to);
    const middle = path.at(0.5);
    expect(middle.k).toBeLessThan(1);
    expect(middle.k).toBeGreaterThan(0.6);
  });
});
