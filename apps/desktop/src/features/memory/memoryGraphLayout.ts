import type { WikiLink } from "./memoryWikiModel";

export type GraphPoint = { readonly x: number; readonly y: number };
/** The box a node and its label occupy, centred on the node, in pixels. */
export type GraphBox = { readonly width: number; readonly height: number };

const GOLDEN_ANGLE = 2.399963229728653;

/** A hub can join several groups without being a good anchor for any one of them. */
export function graphOverview(ids: readonly string[], links: readonly WikiLink[]) {
  const neighbors = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const { source, target } of links) {
    if (source === target || !neighbors.has(source) || !neighbors.has(target)) continue;
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  }
  const degrees = [...neighbors.values()].map((items) => items.size).filter(Boolean).sort((a, b) => a - b);
  const hubDegree = Math.max(12, 2.5 * (degrees[Math.floor(degrees.length / 2)] ?? 0));
  const hubs = new Set(ids.filter((id) => (neighbors.get(id)?.size ?? 0) >= hubDegree));
  const remaining = new Set(ids.filter((id) => !hubs.has(id)));
  const representatives = new Set<string>();
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const group = [first];
    let representative = first;
    let mostNeighbors = 0;
    for (let index = 0; index < group.length; index += 1) {
      const id = group[index];
      let localDegree = 0;
      for (const adjacent of neighbors.get(id) ?? []) {
        if (hubs.has(adjacent)) continue;
        localDegree += 1;
        if (remaining.delete(adjacent)) group.push(adjacent);
      }
      if (localDegree > mostNeighbors) { representative = id; mostNeighbors = localDegree; }
    }
    if (group.length >= 3) representatives.add(representative);
  }
  return { hubs, representatives };
}

type LayoutEdge = readonly [source: number, target: number, weight: number, attraction: number];

/** Force layout of one connected group in abstract units; returns centred positions. */
function layoutComponent(nodes: readonly number[], edges: readonly LayoutEdge[]): { xs: number[]; ys: number[] } {
  const count = nodes.length;
  if (count === 1) return { xs: [0], ys: [0] };
  const xs = nodes.map((_, i) => Math.sqrt(i + 0.5) * Math.cos(i * GOLDEN_ANGLE));
  const ys = nodes.map((_, i) => Math.sqrt(i + 0.5) * Math.sin(i * GOLDEN_ANGLE));
  const local = new Map(nodes.map((node, i) => [node, i]));
  const own = edges.flatMap(([a, b, weight, attraction]) => {
    const i = local.get(a); const j = local.get(b);
    return i === undefined || j === undefined ? [] : [[i, j, weight, attraction] as const];
  });
  const ideal = 1;
  const iterations = 300;
  const dx = new Array<number>(count).fill(0);
  const dy = new Array<number>(count).fill(0);
  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let x = xs[i] - xs[j]; let y = ys[i] - ys[j];
        let distance = Math.hypot(x, y);
        if (distance < 1e-6) { x = 0.01 * (i - j); y = 0.01; distance = Math.hypot(x, y); }
        const force = (ideal * ideal) / distance;
        dx[i] += (x / distance) * force; dy[i] += (y / distance) * force;
        dx[j] -= (x / distance) * force; dy[j] -= (y / distance) * force;
      }
    }
    for (const [a, b, weight, attraction] of own) {
      const x = xs[a] - xs[b]; const y = ys[a] - ys[b];
      const distance = Math.max(1e-6, Math.hypot(x, y));
      const force = ((distance * distance) / ideal) * (0.7 + 0.15 * weight) * attraction;
      dx[a] -= (x / distance) * force; dy[a] -= (y / distance) * force;
      dx[b] += (x / distance) * force; dy[b] += (y / distance) * force;
    }
    const temperature = 0.3 * (1 - step / iterations) + 0.01;
    for (let i = 0; i < count; i += 1) {
      dx[i] -= xs[i] * 0.05; dy[i] -= ys[i] * 0.05;
      const length = Math.hypot(dx[i], dy[i]);
      if (length > 0) {
        const move = Math.min(length, temperature);
        xs[i] += (dx[i] / length) * move; ys[i] += (dy[i] / length) * move;
      }
    }
  }
  const cx = xs.reduce((sum, value) => sum + value, 0) / count;
  const cy = ys.reduce((sum, value) => sum + value, 0) / count;
  return { xs: xs.map((value) => value - cx), ys: ys.map((value) => value - cy) };
}

/**
 * A small deterministic layout for the wiki graph. Each connected group of
 * pages gets its own force layout, groups are packed around the largest one,
 * and a final pass pushes apart nodes whose label boxes would overlap. The
 * same pages always land in the same places, so a reload does not shuffle the
 * graph. Positions are fitted into the given box.
 */
export function layoutGraph(ids: readonly string[], links: readonly WikiLink[], width: number, height: number, padding = 48,
  boxes: ReadonlyMap<string, GraphBox> = new Map(), hubs: ReadonlySet<string> = new Set()): Map<string, GraphPoint> {
  const count = ids.length;
  const result = new Map<string, GraphPoint>();
  if (count === 0) return result;
  if (count === 1) {
    result.set(ids[0], { x: width / 2, y: height / 2 });
    return result;
  }
  const index = new Map(ids.map((id, position) => [id, position]));
  const edges = links.flatMap((link) => {
    const a = index.get(link.source); const b = index.get(link.target);
    const attraction = hubs.has(link.source) || hubs.has(link.target) ? 0.12 : 1;
    return a === undefined || b === undefined ? [] : [[a, b, Math.min(3, link.weight), attraction] as const];
  });
  // Connected groups in input order, largest first.
  const parent = ids.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  ids.forEach((_, i) => { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), i]); });
  const components = [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);

  // Pack each group as a circle around the largest one (abstract units).
  const xs = new Array<number>(count).fill(0);
  const ys = new Array<number>(count).fill(0);
  const placed: { x: number; y: number; r: number }[] = [];
  const gap = 0.9;
  for (const nodes of components) {
    const { xs: lx, ys: ly } = layoutComponent(nodes, edges);
    const radius = Math.max(0.6, ...lx.map((x, i) => Math.hypot(x, ly[i]))) + 0.5;
    let cx = 0; let cy = 0;
    if (placed.length > 0) {
      // Walk a spiral outwards, wider than tall, until the circle fits.
      for (let step = 1; step < 4000; step += 1) {
        const angle = step * GOLDEN_ANGLE;
        const distance = 0.25 * Math.sqrt(step) * (placed[0].r + radius);
        const x = distance * Math.cos(angle) * 1.5; const y = distance * Math.sin(angle);
        if (placed.every((other) => Math.hypot(x - other.x, y - other.y) >= other.r + radius + gap)) { cx = x; cy = y; break; }
      }
    }
    placed.push({ x: cx, y: cy, r: radius });
    nodes.forEach((node, i) => { xs[node] = cx + lx[i]; ys[node] = cy + ly[i]; });
  }

  // Fit into the box; a few loose pages should not stretch one link across the screen.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  const spanX = Math.max(maxX - minX, 1e-6); const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY, 150);
  const offsetX = (width - spanX * scale) / 2; const offsetY = (height - spanY * scale) / 2;
  const px = xs.map((x) => offsetX + (x - minX) * scale);
  const py = ys.map((y) => offsetY + (y - minY) * scale);

  // Push apart overlapping node-and-label boxes along their shorter overlap.
  const box = ids.map((id) => boxes.get(id) ?? { width: 72, height: 40 });
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const overlapX = (box[i].width + box[j].width) / 2 + 6 - Math.abs(px[i] - px[j]);
        const overlapY = (box[i].height + box[j].height) / 2 + 4 - Math.abs(py[i] - py[j]);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapY < overlapX) {
          const push = overlapY / 2 + 0.5; const sign = py[i] < py[j] || (py[i] === py[j] && i < j) ? -1 : 1;
          py[i] += sign * push; py[j] -= sign * push;
        } else {
          const push = overlapX / 2 + 0.5; const sign = px[i] < px[j] || (px[i] === px[j] && i < j) ? -1 : 1;
          px[i] += sign * push; px[j] -= sign * push;
        }
      }
    }
    for (let i = 0; i < count; i += 1) {
      px[i] = Math.min(width - box[i].width / 2 - 8, Math.max(box[i].width / 2 + 8, px[i]));
      py[i] = Math.min(height - box[i].height / 2 - 8, Math.max(box[i].height / 2 + 8, py[i]));
    }
    if (!moved) break;
  }
  ids.forEach((id, i) => result.set(id, { x: px[i], y: py[i] }));
  return result;
}

