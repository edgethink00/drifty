import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { MemoryWikiPage } from "../screen-context/memoryWire";
import type { MemoryCopy } from "./memoryCopy";
import { changedToday, currentLineCount, linkedPageIds, pageMatches, replayOrder, type WikiLink } from "./memoryWikiModel";
import { placeGraphLabels } from "./memoryGraphLabels";
import { graphOverview, layoutGraph, type GraphBox } from "./memoryGraphLayout";
import { createReplay, createSimulation, easeView, fitView, handOver, hold, letGo, settle, showReplay, tickReplay, unsettled, viewPath, zoomAt, type GraphView,
  type ReplayMotion } from "./memoryGraphSim";
import { Icon, type MemoryViewShared } from "./MemoryParts";
import { PageDetail } from "./MemoryPageDetail";

const DRAG_SLOP = 4;
const PANEL_KEY = "drifty.memory.graphPanel";
const PANEL_DEFAULT = 400;
const PANEL_MIN = 300;
/** Room the graph keeps beside the document. */
const GRAPH_MIN = 320;
/** How far in from the visible edge a page counts as in view. */
const REVEAL_MARGIN = 56;
/**
 * Every move of the view follows d3's zoom path for its suggested length,
 * kept within these bounds, on one easing curve.
 */
const GLIDE_MIN_MS = 300;
const GLIDE_MAX_MS = 520;
const ZOOM_GLIDE_MAX_MS = 280;
/** The panel slides out this long before it goes. */
const PANEL_EXIT_MS = 200;
/**
 * The replay's pace, after obsidian-living-graph: about 14 seconds whatever
 * the number of pages, each page 70 to 420 ms after the one before.
 */
const REPLAY_TOTAL_MS = 14_000;
const REPLAY_STEP_MIN_MS = 70;
const REPLAY_STEP_MAX_MS = 420;
/** After the last page arrives the replay lets the graph settle at least this long, and at most the longer time, then hands it back. */
const REPLAY_SETTLE_MS = 1_500;
const REPLAY_SETTLE_MAX_MS = 4_000;
/** How closely the view keeps up with arriving pages: the time it takes to close most of the gap. */
const REPLAY_FOLLOW_MS = 260;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Space the graph leaves free at each edge for what floats over it. */
export type GraphInset = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

/** A plain dot; pages that link to many others and hold more lines grow into visible hubs. */
function nodeRadius(page: MemoryWikiPage, degree: number): number {
  return Math.min(13, 3.5 + 1.8 * Math.sqrt(currentLineCount(page) + 1.5 * degree));
}

/** Room for the dot and its label; wide (CJK) characters take about a full em. */
function nodeBox(page: MemoryWikiPage, degree: number): GraphBox {
  const label = [...page.title].reduce((width, char) => width + (char.codePointAt(0)! > 0x2e80 ? 12.5 : 7.2), 0);
  return { width: Math.max(label + 14, nodeRadius(page, degree) * 2 + 12), height: nodeRadius(page, degree) * 2 + 30 };
}

/** A layout space that grows with the number of pages, shaped like the window it first opened in. */
function layoutSize(count: number, aspect: number): { width: number; height: number } {
  const width = Math.round(Math.min(1800, Math.max(560, 120 * Math.sqrt(count) * 1.3)));
  return { width, height: Math.round(width * aspect) };
}

function prefersStill(): boolean {
  return typeof window === "undefined" || typeof window.requestAnimationFrame !== "function"
    || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

type Gesture =
  | { readonly kind: "node"; readonly id: string; readonly index: number; readonly startX: number; readonly startY: number; readonly dx: number; readonly dy: number; moved: boolean }
  | { readonly kind: "pan"; readonly startX: number; readonly startY: number; readonly view: GraphView; moved: boolean };

/** The replay's progress: how many pages, in the order they began, are shown so far. */
type ReplayState = { readonly shown: number };

function MemoryGraph({ pages, links, matches, selectedId, onSelect, onBackground, inset, request, copy, now, legacy, grouped }: {
  readonly pages: readonly MemoryWikiPage[]; readonly links: readonly WikiLink[]; readonly selectedId: string | null;
  /** Pages matching the rail's search; the rest fade. Null without a search. */
  readonly matches: ReadonlySet<string> | null;
  readonly onSelect: (pageId: string) => void;
  /** A click on empty canvas, without dragging it. */
  readonly onBackground: () => void;
  /** Where the controls and the document cover the canvas; fitting and revealing keep pages out from under them. */
  readonly inset: GraphInset;
  /** A request to bring a page into view, such as one opened from a link in the document. */
  readonly request: { readonly id: string; readonly count: number } | null;
  readonly copy: MemoryCopy; readonly now: Date;
  readonly legacy: boolean;
  readonly grouped: boolean;
}) {
  const measurement = useMemo(() => !legacy && typeof CanvasRenderingContext2D !== "undefined"
    ? document.createElement("canvas").getContext("2d") : null, [legacy]);
  const frame = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 520 });
  // The layout takes the window's shape once; later resizes (or the panel opening) only refit the view.
  const [aspect, setAspect] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const width = Math.max(280, Math.round(element.clientWidth)); const height = Math.max(280, Math.round(element.clientHeight));
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      setAspect((previous) => previous ?? Math.min(1, Math.max(0.5, height / width)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Memory reloads every few seconds with fresh but equal data; only a change in
  // the pages, their sizes or links lays the graph out again.
  const structure = useMemo(() => pages.map((page) => page.id + ":" + currentLineCount(page) + ":" + page.title).join("|")
    + "#" + links.map((link) => link.source + link.target + link.weight).join("|"), [pages, links]);
  const stable = useRef<{ readonly key: string; readonly pages: readonly MemoryWikiPage[]; readonly links: readonly WikiLink[] } | null>(null);
  if (stable.current?.key !== structure) stable.current = { key: structure, pages, links };
  const { pages: laidPages, links: laidLinks } = stable.current;
  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of laidLinks) { counts.set(link.source, (counts.get(link.source) ?? 0) + 1); counts.set(link.target, (counts.get(link.target) ?? 0) + 1); }
    return counts;
  }, [laidLinks]);
  const overview = useMemo(() => grouped ? graphOverview(laidPages.map((page) => page.id), laidLinks) : null,
    [grouped, laidPages, laidLinks]);
  const boxes = useMemo(() => new Map(laidPages.map((page) => {
    const connections = degree.get(page.id) ?? 0;
    if (grouped) {
      const diameter = nodeRadius(page, connections) * 2 + 16;
      return [page.id, { width: diameter, height: diameter }];
    }
    const box = nodeBox(page, connections);
    return [page.id, legacy ? box : { width: Math.min(box.width, 78), height: box.height - 8 }];
  })), [laidPages, degree, legacy, grouped]);
  const space = layoutSize(pages.length, aspect ?? 0.64);
  const homes = useMemo(() => layoutGraph(laidPages.map((page) => page.id), laidLinks, space.width, space.height, 64, boxes, overview?.hubs),
    [laidPages, laidLinks, boxes, space.width, space.height, overview]);
  const shown = useRef<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  // Pages appear where they belong and fade in; only dragging sets the simulation running.
  const sim = useMemo(() => createSimulation(homes, boxes, laidLinks, !legacy && prefersStill() ? undefined : shown.current), [homes, boxes, laidLinks, legacy]);
  shown.current = new Map(sim.nodes.map((node) => [node.id, node]));
  const [, setFrameCount] = useState(0);
  useEffect(() => {
    sim.simulation.on("tick", () => setFrameCount((count) => count + 1));
    // Pages left away from their new homes by a change in the layout ease there.
    if (unsettled(sim) && !prefersStill()) settle(sim);
    return () => { sim.simulation.on("tick", null); sim.simulation.stop(); };
  }, [sim]);

  // The replay: pages arrive in the order they began. It plays on copies of the
  // pages, so it ends wherever the layout changes under it.
  const order = useMemo(() => replayOrder(laidPages).map((page) => page.id), [laidPages]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const replayState = useRef<ReplayState | null>(null);
  const replayMotion = useRef<ReplayMotion | null>(null);
  useEffect(() => () => { replayMotion.current = null; replayState.current = null; setReplay(null); }, [sim]);

  // The view follows the window until the user pans or zooms it themselves.
  const homeBoxes = useMemo(() => sim.nodes.map((node) => ({ x: node.homeX, y: node.homeY, width: node.width, height: node.height })), [sim]);
  const [view, setView] = useState<GraphView>(() => fitView(homeBoxes, size.width, size.height));
  const userMoved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // The view glides frame by frame, so dots, lines and the size of names move together.
  const tween = useRef<number | null>(null);
  const [moving, setMoving] = useState(false);
  const stop = useCallback(() => {
    if (tween.current === null) return;
    window.cancelAnimationFrame(tween.current);
    tween.current = null;
    setMoving(false);
  }, []);
  useEffect(() => stop, [stop]);
  const glide = useCallback((target: GraphView, longest = GLIDE_MAX_MS) => {
    stop();
    if (prefersStill()) { setView(target); return; }
    const path = viewPath(viewRef.current, target, sizeRef.current.width, sizeRef.current.height);
    const duration = Math.min(longest, Math.max(Math.min(GLIDE_MIN_MS, longest), path.duration));
    const started = performance.now();
    setMoving(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setView(path.at(easeInOutCubic(t)));
      if (t < 1) { tween.current = window.requestAnimationFrame(step); return; }
      tween.current = null;
      setMoving(false);
    };
    tween.current = window.requestAnimationFrame(step);
  }, [stop]);
  // The part of the canvas nothing floats over.
  const region = useMemo(() => {
    const width = Math.max(160, size.width - inset.left - inset.right); const height = Math.max(160, size.height - inset.top - inset.bottom);
    return { x: Math.min(inset.left, size.width - width), y: Math.min(inset.top, size.height - height), width, height };
  }, [size.width, size.height, inset.left, inset.right, inset.top, inset.bottom]);
  const fit = useCallback((animate: boolean) => {
    const fitted = fitView(homeBoxes, region.width, region.height);
    const target = { k: fitted.k, tx: fitted.tx + region.x, ty: fitted.ty + region.y };
    if (animate) glide(target);
    else { stop(); setView(target); }
  }, [homeBoxes, region, glide, stop]);
  const regionRef = useRef(region);
  regionRef.current = region;
  const position = (id: string) => {
    const replaying = replay ? replayMotion.current : null;
    if (replaying) return replaying.nodes.get(id) ?? null;
    const index = sim.index.get(id);
    return index === undefined ? null : sim.nodes[index];
  };
  // Bring a page into the free part of the canvas when it is not comfortably there already.
  const reveal = (id: string) => {
    const node = position(id);
    if (!node) return;
    const current = viewRef.current;
    const x = node.x * current.k + current.tx; const y = node.y * current.k + current.ty;
    const margin = Math.min(REVEAL_MARGIN, region.width / 4, region.height / 4);
    if (x >= region.x + margin && x <= region.x + region.width - margin && y >= region.y + margin && y <= region.y + region.height - margin) return;
    // A page brought into view during the replay stays there; the view stops following the arrivals.
    if (replayState.current) userMoved.current = true;
    glide({ ...current, tx: region.x + region.width / 2 - node.x * current.k, ty: region.y + region.height / 2 - node.y * current.k });
  };
  // Fit before paint, so the first frame already shows the pages in place. When
  // the document opens or closes beside it, the graph glides into the space
  // left, unless the user moved it; then only the selected page is kept in view.
  useLayoutEffect(() => { userMoved.current = false; }, [sim]);
  const lastRight = useRef(inset.right);
  useLayoutEffect(() => {
    const panel = lastRight.current !== inset.right;
    lastRight.current = inset.right;
    // The replay's view follows its own pages, in whatever space is left.
    if (replayState.current) return;
    if (!userMoved.current) fit(panel);
    else if (panel && selectedId) reveal(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal reads the latest view; only a new fit or panel edge should run this.
  }, [fit]);
  useEffect(() => {
    if (request) reveal(request.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each request runs once.
  }, [request]);
  const moveView = (next: GraphView) => { userMoved.current = true; glide(next, ZOOM_GLIDE_MAX_MS); };

  // Show the first `shown` pages: newcomers set out from the middle of the layout, pages past the position leave.
  const replayTo = (shown: number) => {
    const motion = replayMotion.current;
    if (!motion) return;
    showReplay(motion, order.slice(0, shown), !prefersStill());
    const next = { shown };
    replayState.current = next;
    setReplay(next);
  };
  const startReplay = () => {
    stop();
    sim.simulation.stop();
    replayMotion.current = createReplay(sim);
    userMoved.current = false;
    replayTo(0);
  };
  // The graph carries on from where the replay left its pages, and the view settles on all of them.
  const endReplay = () => {
    const motion = replayMotion.current;
    if (!motion) return;
    handOver(motion);
    replayMotion.current = null;
    replayState.current = null;
    setReplay(null);
    if (unsettled(sim) && !prefersStill()) settle(sim);
    if (!userMoved.current) fit(true);
  };
  // The frame loop reads these through refs, so it always calls the current ones.
  const replayToRef = useRef(replayTo);
  replayToRef.current = replayTo;
  const endReplayRef = useRef(endReplay);
  endReplayRef.current = endReplay;
  // One step of the view towards all the pages shown so far.
  const followReplay = (motion: ReplayMotion, elapsed: number): boolean => {
    const shown = [...motion.nodes.values()];
    if (shown.length === 0) return false;
    const area = regionRef.current;
    const fitted = fitView(shown, area.width, area.height);
    const current = viewRef.current;
    const next = easeView(current, { k: fitted.k, tx: fitted.tx + area.x, ty: fitted.ty + area.y }, 1 - Math.exp(-elapsed / REPLAY_FOLLOW_MS),
      area.x + area.width / 2, area.y + area.height / 2);
    if (Math.abs(next.k - current.k) < 1e-4 && Math.abs(next.tx - current.tx) < 0.05 && Math.abs(next.ty - current.ty) < 0.05) return false;
    viewRef.current = next;
    setView(next);
    return true;
  };
  const followRef = useRef(followReplay);
  followRef.current = followReplay;
  const replaying = replay !== null;
  useEffect(() => {
    if (!replaying) return;
    const step = Math.min(REPLAY_STEP_MAX_MS, Math.max(REPLAY_STEP_MIN_MS, REPLAY_TOTAL_MS / Math.max(1, orderRef.current.length)));
    // Without motion pages simply appear at home, one step apart, and the view stays put.
    if (prefersStill()) {
      const timer = window.setInterval(() => {
        const state = replayState.current;
        if (!state) return;
        if (state.shown < orderRef.current.length) replayToRef.current(state.shown + 1);
        else endReplayRef.current();
      }, step);
      return () => window.clearInterval(timer);
    }
    let frame = 0;
    let last = performance.now();
    let next = last;
    let finished: number | null = null;
    const loop = (time: number) => {
      const state = replayState.current; const motion = replayMotion.current;
      if (!state || !motion) return;
      const elapsed = Math.min(64, Math.max(0, time - last));
      last = time;
      if (state.shown < orderRef.current.length && time >= next) { replayToRef.current(state.shown + 1); next = time + step; }
      const moved = tickReplay(motion);
      const followed = !userMoved.current && followRef.current(motion, elapsed);
      if (state.shown >= orderRef.current.length) {
        finished ??= time;
        // The last arrivals come to rest in view, then the graph is handed back.
        const settled = !moved && !followed;
        if ((settled && time - finished >= REPLAY_SETTLE_MS) || time - finished >= REPLAY_SETTLE_MAX_MS) { endReplayRef.current(); return; }
      }
      if (moved && !followed) setFrameCount((count) => count + 1);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [replaying]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      stop();
      const current = viewRef.current;
      userMoved.current = true;
      // A pinch arrives as a ctrl-wheel; a two-finger scroll pans.
      if (event.ctrlKey || event.metaKey) setView(zoomAt(current, Math.exp(-event.deltaY * 0.012), event.clientX - rect.left, event.clientY - rect.top));
      else setView({ ...current, tx: current.tx - event.deltaX, ty: current.ty - event.deltaY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [stop]);

  const gesture = useRef<Gesture | null>(null);
  // A drag ends with a click on the same page; that click must not select it.
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const toGraph = (clientX: number, clientY: number) => {
    const rect = svg.current?.getBoundingClientRect();
    const current = viewRef.current;
    return { x: (clientX - (rect?.left ?? 0) - current.tx) / current.k, y: (clientY - (rect?.top ?? 0) - current.ty) / current.k };
  };
  const onNodeDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    dragged.current = false;
    // The replay places pages itself; a press only opens the page.
    if (replayState.current) return;
    const index = sim.index.get(id);
    if (index === undefined) return;
    const point = toGraph(event.clientX, event.clientY);
    const node = sim.nodes[index];
    gesture.current = { kind: "node", id, index, startX: event.clientX, startY: event.clientY, dx: node.x - point.x, dy: node.y - point.y, moved: false };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };
  const onCanvasDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    stop();
    gesture.current = { kind: "pan", startX: event.clientX, startY: event.clientY, view: viewRef.current, moved: false };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setPanning(true);
  };
  const onMove = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pan") {
      if (!active.moved && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < DRAG_SLOP) return;
      active.moved = true;
      userMoved.current = true;
      setView({ ...active.view, tx: active.view.tx + event.clientX - active.startX, ty: active.view.ty + event.clientY - active.startY });
      return;
    }
    if (!active.moved && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < DRAG_SLOP) return;
    active.moved = true;
    const point = toGraph(event.clientX, event.clientY);
    hold(sim, active.index, point.x + active.dx, point.y + active.dy, !prefersStill());
    setFrameCount((count) => count + 1);
  };
  const onUp = () => {
    const active = gesture.current;
    gesture.current = null;
    setPanning(false);
    if (active?.kind === "pan" && !active.moved) { onBackground(); return; }
    if (!active || active.kind !== "node" || !active.moved) return;
    dragged.current = true;
    letGo(sim, active.index, !prefersStill());
    setFrameCount((count) => count + 1);
  };
  const onNodeClick = (pageId: string) => {
    if (dragged.current) { dragged.current = false; return; }
    onSelect(pageId);
  };
  const onKey = (event: ReactKeyboardEvent, pageId: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(pageId); }
  };

  // The grouped overview identifies a hovered page without spotlighting its links.
  // While the camera moves or the replay plays, nodes can slide under a still pointer.
  const [pointed, setHovered] = useState<string | null>(null);
  const hovered = moving || replay || (grouped && panning) ? null : pointed;
  const focus = grouped ? selectedId : hovered ?? selectedId;
  const near = useMemo(() => new Set(focus ? [focus, ...linkedPageIds(focus, links)] : []), [focus, links]);
  // The open page names its neighbours, so the document's links can be found on the graph.
  const around = useMemo(() => new Set(selectedId ? linkedPageIds(selectedId, links) : []), [selectedId, links]);
  // Zoomed out, only large, selected or hovered pages keep a name, at a size that stays readable.
  const quietLabels = view.k < 0.58;
  const labelScale = view.k < 0.85 ? Math.min(1.6, 0.85 / view.k) : 1;
  const fontSize = Math.max(11, Math.min(14, view.k * 13));
  if (measurement && frame.current) measurement.font = fontSize + "px " + getComputedStyle(frame.current).fontFamily;
  const compactLabels = legacy ? null : placeGraphLabels(pages.flatMap((page) => {
    const point = position(page.id);
    if (!point) return [];
    const connections = degree.get(page.id) ?? 0;
    const importance = page.id === selectedId ? 400 : page.id === hovered ? 300 : matches?.has(page.id) ? 200
      : near.has(page.id) || around.has(page.id) ? 100 : 0;
    const eligible = importance > 0 || (matches === null && focus === null);
    const representative = overview?.representatives.has(page.id) ?? false;
    const hub = overview?.hubs.has(page.id) ?? false;
    const groupPriority = hub ? 125 : representative ? 100 : 0;
    return [{
      id: page.id, title: page.title,
      x: view.tx + point.x * view.k, y: view.ty + point.y * view.k,
      radius: nodeRadius(page, connections) * view.k, priority: importance + (importance === 0 ? groupPriority : 0) + Math.min(99, connections),
      important: importance > 0 || representative || connections >= 15,
      retain: page.id === selectedId || page.id === hovered || connections >= 30, eligible,
    }];
  }), region, fontSize, (title) => {
    return measurement?.measureText(title).width ?? Array.from(title).length * fontSize;
  }, matches || focus || view.k > 1.23 ? 14 : grouped ? 7 : 8);
  const centre = () => ({ x: region.x + region.width / 2, y: region.y + region.height / 2 });

  return (
    <div ref={frame} className={"work-memory-graph" + (legacy ? "" : " has-compact-labels") + (grouped ? " has-grouped-layout" : "") + (panning ? " is-panning" : "") + (replay ? " is-replaying" : "")}>
      <svg ref={svg} className="work-memory-graph__svg" width={size.width} height={size.height} role="group" aria-label={copy.graphLabel(pages.length, links.length)}
        onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {aspect === null ? null : <g className="work-memory-graph__world" style={{ transform: "translate(" + view.tx + "px, " + view.ty + "px) scale(" + view.k + ")" }}>
          <g className="work-memory-graph__edges" aria-hidden="true">
            {links.map((link) => {
              const a = position(link.source); const b = position(link.target);
              if (!a || !b) return null;
              const lit = focus !== null && (link.source === focus || link.target === focus);
              const bridge = overview?.hubs.has(link.source) || overview?.hubs.has(link.target);
              const missed = matches !== null && (!matches.has(link.source) || !matches.has(link.target));
              return <line key={link.source + link.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                className={"work-memory-graph__edge" + (lit ? " is-lit" : focus !== null || missed ? " is-dim" : bridge ? " is-bridge" : "")} strokeWidth={legacy ? 1 + Math.min(3, link.weight) * 0.25 + (lit ? 0.4 : 0) : lit ? 1.6 : grouped ? 0.65 : 0.8} />;
            })}
          </g>
          {pages.map((page, index) => {
            const point = position(page.id);
            if (!point) return null;
            const r = nodeRadius(page, degree.get(page.id) ?? 0);
            const selected = page.id === selectedId;
            const previewed = grouped && !selected && page.id === hovered;
            const dim = !previewed && ((focus !== null && !near.has(page.id)) || (matches !== null && !matches.has(page.id) && hovered !== page.id));
            const today = changedToday(page, now);
            const label = compactLabels?.get(page.id);
            const named = near.has(page.id) || selected || around.has(page.id) || (matches !== null ? matches.has(page.id) : !quietLabels || r >= 9);
            return (
              <g key={page.id} className={"work-memory-graph__node work-memory-graph__node--" + page.kind + (selected ? " is-selected" : "") + (dim ? " is-dim" : "") + (hovered === page.id ? " is-focus" : "") + (today ? " is-today" : "")}
                transform={"translate(" + point.x.toFixed(1) + " " + point.y.toFixed(1) + ")"}
                // Pages fade in one after another when the graph opens, never all at once; in the replay each fades in as it arrives.
                style={{ animationDelay: (replay ? 0 : Math.min(index * 18, 260)) + "ms" }}
                role="button" tabIndex={0} aria-pressed={selected} aria-label={page.title + " · " + copy.kinds[page.kind] + " · " + copy.lines(currentLineCount(page)) + (today ? " · " + copy.updatedToday : "")}
                onPointerDown={(event) => onNodeDown(event, page.id)} onClick={() => onNodeClick(page.id)} onKeyDown={(event) => onKey(event, page.id)}
                onPointerEnter={() => setHovered(page.id)} onPointerLeave={() => setHovered((value) => value === page.id ? null : value)}
                onFocus={() => setHovered(page.id)} onBlur={() => setHovered((value) => value === page.id ? null : value)}>
                {/* Green says "updated today" on hover instead of in a legend. */}
                {legacy ? (today ? <title>{copy.updatedToday}</title> : null)
                  : <title>{page.title + (today ? " · " + copy.updatedToday : "")}</title>}
                <circle className="work-memory-graph__hit" r={Math.max(r + 10, 20)} />
                {selected ? <circle className="work-memory-graph__halo" r={r + 7} /> : null}
                {previewed ? <circle className="work-memory-graph__preview-ring" r={r + 5} /> : null}
                <circle className="work-memory-graph__dot" r={r} />
                {compactLabels ? (label ? (
                  <text className="work-memory-graph__label" x={label.dx / view.k} y={label.dy / view.k} textAnchor={label.anchor}
                    style={{ fontSize: fontSize / view.k }}>{label.text}</text>
                ) : null) : <text className={"work-memory-graph__label" + (named ? "" : " is-quiet")} y={r + 5 + 11 * labelScale} textAnchor="middle"
                  style={labelScale === 1 ? undefined : { fontSize: "calc(var(--type-caption-size) * " + labelScale.toFixed(3) + ")" }}>{page.title}</text>}
              </g>
            );
          })}
        </g>}
      </svg>
      <div className="work-memory-graph__zoom" role="group" aria-label={copy.views}>
        <button type="button" className="work-memory-graph__replay" aria-label={copy.replay} title={replay ? copy.replayStop : copy.replayHint} aria-pressed={replay !== null}
          onClick={() => (replay ? endReplay() : startReplay())}><Icon name="replay" size={15} /></button>
        <button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => moveView(zoomAt(view, 1.25, centre().x, centre().y))}><Icon name="plus" size={15} /></button>
        <button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => moveView(zoomAt(view, 0.8, centre().x, centre().y))}><Icon name="minus" size={15} /></button>
        {/* During the replay the view goes back to following the pages as they arrive. */}
        <button type="button" aria-label={copy.zoomFit} title={copy.zoomFit} onClick={() => { userMoved.current = false; if (!replay) fit(true); }}><Icon name="fit" size={15} /></button>
      </div>
    </div>
  );
}

function readPanelWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(PANEL_KEY));
    return Number.isFinite(saved) && saved >= PANEL_MIN ? saved : PANEL_DEFAULT;
  } catch { return PANEL_DEFAULT; }
}

/**
 * The selected page's document beside the graph, on the same screen. One bar
 * holds back, forward and close; the page below reads as it does everywhere,
 * its actions under its title. The left edge drags to resize it.
 */
function GraphPanel({ page, pages, links, headingId, width, bounds, onResize, canBack, canForward, onBack, onForward, onOpenPage, onClose, leaving = false, shared }: {
  readonly page: MemoryWikiPage; readonly pages: readonly MemoryWikiPage[]; readonly links: readonly WikiLink[]; readonly headingId: string;
  /** Closed and sliding out; it no longer takes input or counts as on screen. */
  readonly leaving?: boolean;
  readonly width: number; readonly bounds: { readonly min: number; readonly max: number };
  readonly onResize: (width: number) => void;
  readonly canBack: boolean; readonly canForward: boolean; readonly onBack: () => void; readonly onForward: () => void;
  readonly onOpenPage: (pageId: string) => void; readonly onClose: () => void; readonly shared: MemoryViewShared;
}) {
  const { copy } = shared;
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setOpenLineId(null); scroll.current?.scrollTo?.({ top: 0 }); }, [page.id]);
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
  const onGripKey = (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step : event.key === "Home" ? bounds.max : event.key === "End" ? bounds.min : null;
    if (next === null) return;
    event.preventDefault();
    onResize(clamp(next));
  };
  return (
    <aside className={"work-memory-graph-panel" + (leaving ? " is-leaving" : "")} style={{ width }} aria-labelledby={leaving ? undefined : headingId}
      aria-hidden={leaving || undefined} {...(leaving ? { inert: "" } : {})}>
      <div className="work-memory-graph-panel__grip" role="separator" aria-orientation="vertical" aria-label={copy.resizePanel} tabIndex={0}
        aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width} onKeyDown={onGripKey}
        onPointerDown={(event) => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; (event.currentTarget as Element).setPointerCapture?.(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) onResize(clamp(drag.current.width + drag.current.x - event.clientX)); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} />
      <div className="work-memory-graph-panel__bar">
        <div className="work-memory-graph-panel__nav">
          <button type="button" className="work-memory-icon-btn" aria-label={copy.back} title={copy.back} disabled={!canBack} onClick={onBack}><Icon name="back" size={16} /></button>
          <button type="button" className="work-memory-icon-btn" aria-label={copy.forward} title={copy.forward} disabled={!canForward} onClick={onForward}><Icon name="chevron" size={16} /></button>
        </div>
        <div className="work-memory-graph-panel__end">
          <button type="button" className="work-memory-icon-btn" aria-label={copy.closePanel} title={copy.closePanel} onClick={onClose}><Icon name="close" size={15} /></button>
        </div>
      </div>
      <div ref={scroll} className="work-memory-graph-panel__scroll">
        <PageDetail page={page} pages={pages} links={links} headingId={headingId} openLineId={openLineId} onToggleLine={setOpenLineId} onOpenPage={onOpenPage} shared={shared} />
      </div>
    </aside>
  );
}

type Trail = { readonly ids: readonly string[]; readonly at: number };

/**
 * Graph: the pages and how they link, filling the view under the rail's
 * floating controls. Choosing a page opens its document beside the graph on
 * the same screen; links in the document select their page on the graph and
 * bring it into view. Pages bloom out from the centre, can be dragged (their
 * neighbours follow), and the view pans and pinch-zooms. The search fades the
 * rest. Escape or a click on empty canvas closes the document.
 */
export function MemoryGraphView({ pages, links, selectedId, onSelect, reserve, headingId, shared, legacy = false, grouped = true }: {
  readonly legacy?: boolean;
  readonly grouped?: boolean;
  readonly pages: readonly MemoryWikiPage[]; readonly links: readonly WikiLink[]; readonly selectedId: string | null;
  readonly onSelect: (pageId: string | null) => void;
  /** The heights the rail's controls take at the top and foot of the canvas. */
  readonly reserve: { readonly top: number; readonly bottom: number };
  readonly headingId: string; readonly shared: MemoryViewShared;
}) {
  const selected = pages.find((page) => page.id === selectedId) ?? null;
  const { query } = shared;
  const matches = useMemo(() => query.trim() ? new Set(pages.filter((page) => pageMatches(page, query)).map((page) => page.id)) : null, [pages, query]);
  const root = useRef<HTMLDivElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setViewWidth(Math.round(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [wanted, setWanted] = useState(readPanelWidth);
  const bounds = { min: PANEL_MIN, max: Math.max(PANEL_MIN, Math.min(720, (viewWidth || 1024) - GRAPH_MIN)) };
  const width = Math.round(Math.min(bounds.max, Math.max(bounds.min, wanted)));
  const resized = useRef(false);
  const resize = (next: number) => { resized.current = true; setWanted(next); };
  useEffect(() => {
    if (!resized.current) return;
    const timer = setTimeout(() => { try { window.localStorage.setItem(PANEL_KEY, String(wanted)); } catch { /* A convenience only. */ } }, 250);
    return () => clearTimeout(timer);
  }, [wanted]);

  // Pages opened here, so back and forward retrace them; a page deleted since is skipped.
  const [trail, setTrail] = useState<Trail>(() => ({ ids: selectedId ? [selectedId] : [], at: selectedId ? 0 : -1 }));
  useEffect(() => {
    if (!selectedId) return;
    setTrail((current) => {
      if (current.ids[current.at] === selectedId) return current;
      const ids = [...current.ids.slice(0, current.at + 1), selectedId].slice(-50);
      return { ids, at: ids.length - 1 };
    });
  }, [selectedId]);
  const exists = useMemo(() => new Set(pages.map((page) => page.id)), [pages]);
  const step = (direction: -1 | 1): number => {
    for (let index = trail.at + direction; index >= 0 && index < trail.ids.length; index += direction) if (exists.has(trail.ids[index])) return index;
    return -1;
  };
  const [focus, setFocus] = useState<{ readonly id: string; readonly count: number } | null>(null);
  const reveal = (id: string) => setFocus((previous) => ({ id, count: (previous?.count ?? 0) + 1 }));
  const walk = (direction: -1 | 1) => {
    const index = step(direction);
    if (index < 0) return;
    setTrail((current) => ({ ...current, at: index }));
    onSelect(trail.ids[index]);
    reveal(trail.ids[index]);
  };
  const follow = (pageId: string) => { onSelect(pageId); reveal(pageId); };

  const open = selected !== null;
  // A closed page's panel slides out while the graph glides back, instead of vanishing.
  const [leaving, setLeaving] = useState<MemoryWikiPage | null>(null);
  const last = useRef<MemoryWikiPage | null>(null);
  useEffect(() => {
    if (selected) { last.current = selected; setLeaving(null); return; }
    const closed = last.current;
    last.current = null;
    if (!closed || prefersStill()) return;
    setLeaving(closed);
    const timer = setTimeout(() => setLeaving(null), PANEL_EXIT_MS);
    return () => clearTimeout(timer);
  }, [selected]);
  const panelPage = selected ?? leaving;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog']") || document.querySelector("[role='dialog'][aria-modal='true']")) return;
      onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onSelect]);

  const inset: GraphInset = useMemo(() => ({ top: reserve.top, bottom: reserve.bottom, left: 0, right: open ? width : 0 }), [reserve.top, reserve.bottom, open, width]);
  return (
    <div ref={root} className={"work-memory-graph-view" + (open ? " has-panel" : "")} style={{ ["--graph-panel" as string]: (open ? width : 0) + "px" }}>
      <MemoryGraph key={legacy ? "before" : grouped ? "a2" : "a"} legacy={legacy} grouped={grouped && !legacy} pages={pages} links={links} matches={matches} selectedId={selected?.id ?? null} onSelect={onSelect} onBackground={() => onSelect(null)}
        inset={inset} request={focus} copy={shared.copy} now={shared.now} />
      {panelPage ? (
        // One element whether open or sliding out, so the page keeps its scroll while it leaves.
        <GraphPanel page={panelPage} pages={pages} links={links} headingId={headingId} width={width} bounds={bounds} leaving={!selected}
          onResize={resize} canBack={selected !== null && step(-1) >= 0} canForward={selected !== null && step(1) >= 0} onBack={() => walk(-1)} onForward={() => walk(1)}
          onOpenPage={follow} onClose={() => onSelect(null)} shared={shared} />
      ) : null}
    </div>
  );
}
