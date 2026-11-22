import { forceCollide, forceLink, forceSimulation, forceX, forceY, type ForceLink, type ForceX, type ForceY, type Simulation, type SimulationLinkDatum,
  type SimulationNodeDatum } from "d3-force";
import { interpolateZoom } from "d3-interpolate";

/**
 * The motion behind the memory graph, on d3-force (ISC, the engine behind
 * Logseq's and Quartz's graph views) rather than a hand-made spring. Every page
 * has a home, its place in the computed layout; forces pull it there, keep
 * links at their home length and keep dots apart. At rest the simulation is
 * stopped, so the layout stays as computed; it only runs while a page is
 * dragged and as things settle afterwards. d3's friction stops pages short of
 * their target instead of swinging past it, and as it cools they stop where
 * they are: like Logseq and Quartz, a drag rearranges its neighbourhood a
 * little, and that becomes the layout. ISC notice: public/third-party/D3-LICENSE.txt.
 */
export type SimNode = SimulationNodeDatum & {
  readonly id: string;
  x: number; y: number;
  homeX: number; homeY: number;
  readonly width: number; readonly height: number;
};
export type SimLink = SimulationLinkDatum<SimNode> & { readonly source: SimNode; readonly target: SimNode; rest: number };
export type SimBox = { readonly width: number; readonly height: number };
export type GraphMotion = {
  readonly nodes: SimNode[]; readonly links: SimLink[]; readonly index: ReadonlyMap<string, number>;
  readonly simulation: Simulation<SimNode, SimLink>;
};

/** A little more friction than d3's default 0.4, so pages ease in rather than overshoot. */
const VELOCITY_DECAY = 0.5;
/** Cools down within about a second of letting go (d3's default takes about five). */
const ALPHA_DECAY = 0.06;
const HOME_STRENGTH = 0.12;
const LINK_STRENGTH = 0.3;
/** How lively the graph stays while a page is held: neighbours follow without racing. */
const HOLD_ALPHA = 0.22;

/** The dot and a little room around it; names may overlap their neighbours' lines, not their dots. */
function dotRoom(node: SimNode): number {
  return Math.max(10, node.height / 2 - 5);
}

/** Pages already on screen (`previous`) move on from where they are; the rest start at home. */
export function createSimulation(homes: ReadonlyMap<string, { readonly x: number; readonly y: number }>, boxes: ReadonlyMap<string, SimBox>,
  links: readonly { readonly source: string; readonly target: string }[],
  previous: ReadonlyMap<string, { readonly x: number; readonly y: number }> = new Map()): GraphMotion {
  const nodes: SimNode[] = [...homes].map(([id, home]) => {
    const box = boxes.get(id) ?? { width: 24, height: 24 };
    const was = previous.get(id);
    return { id, x: was?.x ?? home.x, y: was?.y ?? home.y, vx: 0, vy: 0, homeX: home.x, homeY: home.y, width: box.width, height: box.height };
  });
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const simLinks: SimLink[] = links.flatMap((link) => {
    const a = index.get(link.source); const b = index.get(link.target);
    if (a === undefined || b === undefined) return [];
    const source = nodes[a]; const target = nodes[b];
    return [{ source, target, rest: Math.hypot(source.homeX - target.homeX, source.homeY - target.homeY) }];
  });
  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .velocityDecay(VELOCITY_DECAY)
    .alphaDecay(ALPHA_DECAY)
    .force("link", forceLink<SimNode, SimLink>(simLinks).distance((link) => link.rest).strength(LINK_STRENGTH))
    .force("x", forceX<SimNode>((node) => node.homeX).strength(HOME_STRENGTH))
    .force("y", forceY<SimNode>((node) => node.homeY).strength(HOME_STRENGTH))
    .force("collide", forceCollide<SimNode>(dotRoom).strength(0.7))
    .stop();
  const motion = { nodes, links: simLinks, index, simulation };
  simulation.on("end.rest", () => rest(motion));
  return motion;
}

/** Where pages came to rest becomes their home, and links take the lengths they settled at; a dropped page lets go of its pin. */
function rest(motion: GraphMotion): void {
  for (const node of motion.nodes) { node.homeX = node.x; node.homeY = node.y; node.vx = 0; node.vy = 0; node.fx = null; node.fy = null; }
  for (const link of motion.links) link.rest = Math.hypot(link.source.homeX - link.target.homeX, link.source.homeY - link.target.homeY);
  aim(motion);
}

/** Forces read their targets once; hand them the current homes and lengths. */
function aim(motion: GraphMotion): void {
  (motion.simulation.force("x") as ForceX<SimNode>).x((each) => each.homeX);
  (motion.simulation.force("y") as ForceY<SimNode>).y((each) => each.homeY);
  (motion.simulation.force("link") as ForceLink<SimNode, SimLink>).distance((link) => link.rest);
}

/** True when some page is away from its home, as after the layout changed under pages on screen. */
export function unsettled(motion: GraphMotion): boolean {
  return motion.nodes.some((node) => Math.hypot(node.x - node.homeX, node.y - node.homeY) > 0.5);
}

/** Let pages away from home settle there. */
export function settle(motion: GraphMotion): void {
  motion.simulation.alpha(0.5).restart();
}

/** The pointer holds a page at (x, y); with motion its neighbours follow, without it only the page moves. */
export function hold(motion: GraphMotion, i: number, x: number, y: number, animate: boolean): void {
  const node = motion.nodes[i];
  node.fx = x; node.fy = y;
  if (!animate) { node.x = x; node.y = y; return; }
  if (motion.simulation.alpha() < HOLD_ALPHA) motion.simulation.alpha(HOLD_ALPHA);
  motion.simulation.alphaTarget(HOLD_ALPHA).restart();
}

/**
 * A page let go stays pinned where it was dropped while the rest settles (d3's
 * "sticky" drag); its links take the new length. Once all is still, it is
 * simply at home there.
 */
export function letGo(motion: GraphMotion, i: number, animate: boolean): void {
  const node = motion.nodes[i];
  node.homeX = node.fx ?? node.x; node.homeY = node.fy ?? node.y;
  node.x = node.homeX; node.y = node.homeY;
  node.fx = node.homeX; node.fy = node.homeY;
  for (const link of motion.links) {
    if (link.source !== node && link.target !== node) continue;
    link.rest = Math.hypot(link.source.homeX - link.target.homeX, link.source.homeY - link.target.homeY);
  }
  aim(motion);
  motion.simulation.alphaTarget(0);
  if (animate) return;
  motion.simulation.stop();
  rest(motion);
}

/**
 * The replay: the graph as it grew, after d3's "Temporal force-directed graph"
 * example (ISC) and the timelapse in the obsidian-living-graph plugin (MIT).
 * Pages arrive in the order given; only pages that have arrived and the links
 * between them take part. A newcomer buds from the nearest linked page already
 * shown, on the side facing its home, and drifts there; one with nothing to
 * link to yet appears at home. The replay moves copies of the pages in its own
 * simulation, pulled to the same homes, so the graph's layout is never touched
 * and the replay ends where the graph rests. The caller ticks it frame by frame.
 */
export type ReplayMotion = {
  readonly source: GraphMotion;
  /** Pages that have arrived, in the order they did. */
  readonly nodes: Map<string, SimNode>;
  readonly simulation: Simulation<SimNode, SimLink>;
};

/** A newcomer starts this far out from the page it buds from, or halfway home if that is nearer. */
const BUD_DISTANCE = 46;
/** The life each arrival gives the replay; it cools within about a second and a half. */
const ARRIVAL_ALPHA = 0.5;
/** Once the replay has cooled, the share of the way home a page still short of it covers each frame. */
const HOME_GLIDE = 0.12;

export function createReplay(source: GraphMotion): ReplayMotion {
  const simulation = forceSimulation<SimNode, SimLink>([])
    .velocityDecay(VELOCITY_DECAY)
    .alphaDecay(ALPHA_DECAY)
    .force("link", forceLink<SimNode, SimLink>([]).distance((link) => link.rest).strength(LINK_STRENGTH))
    .force("x", forceX<SimNode>((node) => node.homeX).strength(HOME_STRENGTH))
    .force("y", forceY<SimNode>((node) => node.homeY).strength(HOME_STRENGTH))
    .force("collide", forceCollide<SimNode>(dotRoom).strength(0.7))
    .stop()
    .alpha(0);
  return { source, nodes: new Map(), simulation };
}

/** The shown page linked to `page` whose home is nearest its own. */
function budParent(replay: ReplayMotion, page: SimNode): SimNode | null {
  let parent: SimNode | null = null;
  let nearest = Infinity;
  for (const link of replay.source.links) {
    const other = link.source.id === page.id ? link.target : link.target.id === page.id ? link.source : null;
    const shown = other ? replay.nodes.get(other.id) : undefined;
    if (!shown) continue;
    const distance = Math.hypot(shown.homeX - page.homeX, shown.homeY - page.homeY);
    if (distance < nearest) { nearest = distance; parent = shown; }
  }
  return parent;
}

/**
 * Show exactly `ids`, in the order they arrive: newcomers bud and drift home,
 * pages past the replay's position leave. Without motion pages appear at home.
 */
export function showReplay(replay: ReplayMotion, ids: readonly string[], animate: boolean): void {
  const wanted = new Set(ids);
  for (const id of [...replay.nodes.keys()]) if (!wanted.has(id)) replay.nodes.delete(id);
  let arrived = false;
  for (const id of ids) {
    if (replay.nodes.has(id)) continue;
    const index = replay.source.index.get(id);
    if (index === undefined) continue;
    const page = replay.source.nodes[index];
    const node: SimNode = { id, x: page.homeX, y: page.homeY, vx: 0, vy: 0, homeX: page.homeX, homeY: page.homeY, width: page.width, height: page.height };
    const parent = animate ? budParent(replay, page) : null;
    if (parent) {
      const dx = page.homeX - parent.homeX; const dy = page.homeY - parent.homeY;
      const length = Math.hypot(dx, dy);
      const reach = Math.min(BUD_DISTANCE, length / 2);
      node.x = parent.x + (length > 0 ? dx / length : 1) * reach;
      node.y = parent.y + (length > 0 ? dy / length : 0) * reach;
    }
    replay.nodes.set(id, node);
    arrived = true;
  }
  const links = replay.source.links.flatMap((link) => {
    const source = replay.nodes.get(link.source.id); const target = replay.nodes.get(link.target.id);
    return source && target ? [{ source, target, rest: link.rest }] : [];
  });
  replay.simulation.nodes([...replay.nodes.values()]);
  (replay.simulation.force("link") as ForceLink<SimNode, SimLink>).links(links);
  if (arrived && animate) replay.simulation.alpha(Math.max(replay.simulation.alpha(), ARRIVAL_ALPHA));
}

/**
 * One frame of the replay's motion; false once every page is at home. d3's
 * friction leaves pages a little short of home as it cools, so they then
 * glide the rest of the way and the replay ends exactly on the layout.
 */
export function tickReplay(replay: ReplayMotion): boolean {
  if (replay.simulation.alpha() >= replay.simulation.alphaMin()) {
    replay.simulation.tick();
    return true;
  }
  let moving = false;
  for (const node of replay.nodes.values()) {
    const dx = node.homeX - node.x; const dy = node.homeY - node.y;
    if (Math.hypot(dx, dy) < 0.5) { node.x = node.homeX; node.y = node.homeY; continue; }
    node.x += dx * HOME_GLIDE; node.y += dy * HOME_GLIDE;
    moving = true;
  }
  return moving;
}

/** The graph carries on from where the replay left its pages; pages that had not arrived wait at home. */
export function handOver(replay: ReplayMotion): void {
  replay.simulation.stop();
  for (const node of replay.source.nodes) {
    const shown = replay.nodes.get(node.id);
    if (!shown) continue;
    node.x = shown.x; node.y = shown.y; node.vx = 0; node.vy = 0;
  }
}

export type GraphView = { readonly k: number; readonly tx: number; readonly ty: number };
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.6;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Scale and offset that show every page and its label with some room, never enlarging past `maxScale`. */
export function fitView(nodes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
  width: number, height: number, padding = 48, maxScale = 1.15): GraphView {
  if (nodes.length === 0 || width <= 0 || height <= 0) return { k: 1, tx: 0, ty: 0 };
  const left = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const right = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const top = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2));
  const k = clamp(Math.min((width - 2 * padding) / Math.max(1, right - left), (height - 2 * padding) / Math.max(1, bottom - top), maxScale), MIN_ZOOM, MAX_ZOOM);
  return { k, tx: width / 2 - ((left + right) / 2) * k, ty: height / 2 - ((top + bottom) / 2) * k };
}

/**
 * The way from one view to another along d3's zoom path (van Wijk and Nuij,
 * "Smooth and efficient zooming and panning"), with its suggested length in
 * milliseconds. `at(t)` gives the view at t from 0 to 1.
 */
export function viewPath(from: GraphView, to: GraphView, width: number, height: number): { readonly duration: number; readonly at: (t: number) => GraphView } {
  const cx = width / 2; const cy = height / 2;
  const path = interpolateZoom([(cx - from.tx) / from.k, (cy - from.ty) / from.k, width / from.k], [(cx - to.tx) / to.k, (cy - to.ty) / to.k, width / to.k]);
  return {
    duration: path.duration,
    at: (t) => {
      if (t >= 1) return to;
      const [x, y, w] = path(t);
      const k = width / w;
      return { k, tx: cx - x * k, ty: cy - y * k };
    },
  };
}

/** Zoom by `factor` keeping the point under the pointer where it is. */
export function zoomAt(view: GraphView, factor: number, px: number, py: number): GraphView {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const applied = k / view.k;
  return { k, tx: px - (px - view.tx) * applied, ty: py - (py - view.ty) * applied };
}

/**
 * A step of the view towards `to` that stays smooth while the target itself
 * moves, as when the replay follows pages arriving: the graph point at
 * (px, py) and the scale, in proportion, each go `share` of the way.
 */
export function easeView(from: GraphView, to: GraphView, share: number, px: number, py: number): GraphView {
  if (share >= 1) return to;
  const k = from.k * Math.pow(to.k / from.k, share);
  const fromX = (px - from.tx) / from.k; const fromY = (py - from.ty) / from.k;
  const x = fromX + ((px - to.tx) / to.k - fromX) * share;
  const y = fromY + ((py - to.ty) / to.k - fromY) * share;
  return { k, tx: px - x * k, ty: py - y * k };
}

