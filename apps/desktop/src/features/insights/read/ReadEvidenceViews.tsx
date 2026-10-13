import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import type { AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../../components/AppGlyph";
import { SiteFavicon } from "../../../components/SiteFavicon";
import { useSiteIcon } from "../../../components/SiteIconContext";
import { useAppIconPresentation } from "../../../components/useAppIconPresentation";
import { useLocalization } from "../../localization/LocalizationContext";
import { durationLabel } from "./readFormat";
import { switchTotals } from "./readFacts";
import { localize, type InsightsRead, type ReadApp, type ReadSplitEvidence, type ReadSwitch } from "./readModel";

/*
 * Two more ways to see a split read when it is about apps, after Dayflow's
 * app web and time-flow views: which apps the day switched between, and where
 * an average day's time went. Both show the side of the comparison picked
 * above the evidence and count the change against the other side, so neither
 * redraws Your usage's rankings or transitions for the selected range.
 */

type Kind = ReadApp["kind"];
type Group = 0 | 1;

/** Time flow stacks its classes in this order, top to bottom: focus, then drift right under it so the two the read compares sit together, then neutral. */
const KINDS: readonly Kind[] = ["focus", "drift", "neutral"];
const MINUTE = 60;

function kindLabelKey(kind: Kind) {
  return ("activity.productivity." + kind) as "activity.productivity.focus";
}

/* ------------------------------------------------------------ app icons */

function appIconSource(app: ReadApp, appIcons: AppIconMap): string | null {
  return (app.bundleId ? appIcons[app.bundleId] : undefined) ?? appIcons[app.label] ?? null;
}

/** An app's own icon from the sources Your usage reads: the app icon map, or the site icon cache for a site. */
function useShownIcon(app: ReadApp, appIcons: AppIconMap): readonly [string | null, () => void] {
  const site = useSiteIcon(app.siteDomain);
  const calibrated = useAppIconPresentation(site ? null : appIconSource(app, appIcons));
  const src = site ?? calibrated ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  return [src && failed !== src ? src : null, () => setFailed(src)];
}

/** An icon in an SVG picture, centred on (x, y), with the rounded corners an icon has in a list. */
function SvgIcon({ src, x, y, size, onError }: { readonly src: string; readonly x: number; readonly y: number; readonly size: number; readonly onError: () => void }) {
  const clip = "rp-clip-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const left = (x - size / 2).toFixed(1);
  const top = (y - size / 2).toFixed(1);
  return (
    <>
      <clipPath id={clip}><rect x={left} y={top} width={size.toFixed(1)} height={size.toFixed(1)} rx={(size * 0.22).toFixed(1)} /></clipPath>
      <image className="rp-icon" href={src} x={left} y={top} width={size.toFixed(1)} height={size.toFixed(1)} clipPath={"url(#" + clip + ")"} preserveAspectRatio="xMidYMid meet" onError={onError} />
    </>
  );
}

/** The same icon in a list row, through the components Your usage's lists use. */
function ListIcon({ app, appIcons }: { readonly app: ReadApp; readonly appIcons: AppIconMap }) {
  const fallback = appIconSource(app, appIcons);
  return (
    <span className="rp-link__icon" data-app={app.id}>
      {app.siteDomain
        ? <SiteFavicon domain={app.siteDomain} size={22} fallbackIconSrc={fallback} />
        : <AppGlyph appName={app.label} iconSrc={fallback} size="sm" />}
    </span>
  );
}

/* ------------------------------------------------------------ app web */

/** At most this many apps around the hub; a heavier week's other apps stay in the list and in time flow. */
export const WEB_RING_MAX = 12;
/** At most this many lines, busiest first; the subject's own lines are always drawn. */
export const WEB_EDGE_MAX = 20;
/** No class takes more than this many places on the ring while another class still has apps waiting. */
const RING_PER_CLASS = 5;
/** The subject's busiest partners that always get a place, so the read's own links are on the picture. */
const SUBJECT_PARTNERS = 5;
/** Room along the ring between two classes, and around each app. */
const CLASS_ROOM = 34;
const NODE_ROOM = 16;
/** Clockwise from the right: drift on the right, neutral below, focus round the left and over the top. */
const RING_ORDER: readonly Kind[] = ["drift", "neutral", "focus"];
const RING_CENTRE: Record<Kind, number> = { drift: 0, neutral: Math.PI / 2, focus: (Math.PI * 11) / 10 };

type Geometry = { readonly w: number; readonly h: number; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly scale: number };

/** The picture grows with the ring, so a heavy week's apps keep their room; its nodes come down a size. */
function geometryFor(ringSize: number): Geometry {
  if (ringSize > 8) return { w: 540, h: 344, cx: 270, cy: 172, rx: 222, ry: 134, scale: 0.88 };
  if (ringSize <= 4) return { w: 440, h: 280, cx: 220, cy: 140, rx: 150, ry: 98, scale: 1 };
  return { w: 440, h: 300, cx: 220, cy: 150, rx: 178, ry: 114, scale: 1 };
}

type Placed = { readonly app: ReadApp; readonly x: number; readonly y: number; readonly hub: boolean };
type Point = { readonly x: number; readonly y: number };

function nodeRadius(seconds: number, scale: number): number {
  return Math.min(28, seconds === 0 ? 13 : 12.5 + Math.sqrt(seconds / MINUTE) * 1.05) * scale;
}

/** Points along the ring by distance travelled, so apps are spaced by real length, not by angle (the ring is flatter top and bottom). */
function ringTable(g: Geometry) {
  const steps = 720;
  const points: { readonly angle: number; readonly at: number; readonly x: number; readonly y: number }[] = [];
  let at = 0;
  let previous: Point | null = null;
  for (let index = 0; index <= steps; index += 1) {
    const angle = -Math.PI + (2 * Math.PI * index) / steps;
    const point = { x: g.cx + g.rx * Math.cos(angle), y: g.cy + g.ry * Math.sin(angle) };
    if (previous) at += Math.hypot(point.x - previous.x, point.y - previous.y);
    points.push({ angle, at, ...point });
    previous = point;
  }
  const total = at;
  const lengthAt = (angle: number) => points[Math.round(((angle + Math.PI) / (2 * Math.PI)) * steps) % steps].at;
  const pointAt = (length: number): Point => {
    const target = ((length % total) + total) % total;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid].at < target) low = mid + 1; else high = mid;
    }
    return points[low];
  };
  return { total, lengthAt, pointAt };
}

/**
 * The app with the most switches across both groups sits in the middle, the
 * way Dayflow centres its busiest app. Up to WEB_RING_MAX others ring it:
 * the read's subject and its busiest partners first, then the busiest of the
 * rest, no class taking more than RING_PER_CLASS places while another still
 * has apps; apps with no switches are left out. Each class keeps its own stretch of the ring, and each app gets
 * ring length for its size, so a heavy week does not crowd and a light one
 * spreads out. Within a class the biggest app sits mid-stretch. Places stay
 * the same whichever group is shown, so switching groups shows the change.
 */
export function placeApps(apps: readonly ReadApp[], switches: readonly ReadSwitch[], subjectId?: string): { readonly placed: Map<string, Placed>; readonly geometry: Geometry } {
  const traffic = new Map<string, number>();
  for (const edge of switches) {
    for (const id of [edge.a, edge.b]) traffic.set(id, (traffic.get(id) ?? 0) + edge.perDay[0] + edge.perDay[1]);
  }
  const linked = apps.filter((app) => app.id !== "other" && (traffic.get(app.id) ?? 0) > 0)
    .sort((a, b) => traffic.get(b.id)! - traffic.get(a.id)! || (b.seconds[0] + b.seconds[1]) - (a.seconds[0] + a.seconds[1]));
  const placed = new Map<string, Placed>();
  if (linked.length === 0) return { placed, geometry: geometryFor(0) };
  const [hub, ...rest] = linked;
  const ring: ReadApp[] = [];
  const take = (app: ReadApp | undefined) => { if (app && !ring.includes(app) && ring.length < WEB_RING_MAX) ring.push(app); };
  if (subjectId !== undefined) {
    take(rest.find((app) => app.id === subjectId));
    const partners = switches.filter((edge) => edge.a === subjectId || edge.b === subjectId)
      .sort((a, b) => b.perDay[0] + b.perDay[1] - (a.perDay[0] + a.perDay[1]))
      .map((edge) => (edge.a === subjectId ? edge.b : edge.a));
    for (const id of partners.slice(0, SUBJECT_PARTNERS)) take(rest.find((app) => app.id === id));
  }
  const count = (kind: Kind) => ring.filter((app) => app.kind === kind).length;
  for (const app of rest) if (count(app.kind) < RING_PER_CLASS) take(app);
  for (const app of rest) take(app);
  const g = geometryFor(ring.length);
  placed.set(hub.id, { app: hub, x: g.cx, y: g.cy, hub: true });
  if (ring.length === 0) return { placed, geometry: g };

  const table = ringTable(g);
  const width = (app: ReadApp) => 2 * nodeRadius(Math.max(app.seconds[0], app.seconds[1]), g.scale) + NODE_ROOM;
  const classes = RING_ORDER.map((kind) => {
    const members = ring.filter((app) => app.kind === kind).sort((a, b) => width(b) - width(a));
    // Biggest in the middle of its stretch, the rest alternating out to either side.
    const ordered: ReadApp[] = [];
    members.forEach((app, index) => (index % 2 ? ordered.unshift(app) : ordered.push(app)));
    return { kind, members: ordered };
  }).filter((entry) => entry.members.length > 0);
  const gaps = classes.length > 1 ? classes.length * CLASS_ROOM : 0;
  const need = ring.reduce((sum, app) => sum + width(app), 0) + gaps;
  const stretch = table.total / need;
  const span = (entry: { members: readonly ReadApp[] }) => entry.members.reduce((sum, app) => sum + width(app), 0) * stretch;
  // The first class sits centred on its own side; the others follow clockwise.
  let at = table.lengthAt(RING_CENTRE[classes[0].kind]) - span(classes[0]) / 2;
  for (const entry of classes) {
    for (const app of entry.members) {
      const point = table.pointAt(at + (width(app) * stretch) / 2);
      placed.set(app.id, { app, x: point.x, y: point.y, hub: false });
      at += width(app) * stretch;
    }
    if (classes.length > 1) at += CLASS_ROOM * stretch;
  }
  return { placed, geometry: g };
}

/** A point just outside a node's ring, on the way to (qx, qy), where a line starts. */
function rim(node: Placed, radius: number, qx: number, qy: number): Point {
  const dx = qx - node.x;
  const dy = qy - node.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: node.x + (dx / length) * (radius + 4.5), y: node.y + (dy / length) * (radius + 4.5) };
}

function along(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/**
 * The bend of one line. Lines from the hub are spokes with a slight curve;
 * lines between two outer apps bow outward, around the hub. Each line takes
 * whichever of a few bends keeps it furthest from the other apps.
 */
function bendFor(a: Placed, b: Placed, others: readonly { readonly x: number; readonly y: number; readonly r: number }[], g: Geometry): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  let ox = mx - g.cx;
  let oy = my - g.cy;
  const off = Math.hypot(ox, oy);
  // A line that passes close to the middle bows to one side instead of outward.
  if (off < 24) { ox = nx; oy = ny; } else { ox /= off; oy /= off; }
  const spoke = a.hub || b.hub;
  const pushes = spoke ? [length * 0.1, -length * 0.1, 0] : [18 + length * 0.22, 8 + length * 0.1, -(6 + length * 0.1), 0];
  const dirX = spoke ? nx : ox;
  const dirY = spoke ? ny : oy;
  let best = { x: mx, y: my };
  let bestClear = -Infinity;
  for (const push of pushes) {
    const c = { x: mx + dirX * push, y: my + dirY * push };
    let clear = Infinity;
    for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const p = along(a, c, b, t);
      for (const node of others) clear = Math.min(clear, Math.hypot(p.x - node.x, p.y - node.y) - node.r);
    }
    // Prefer the first bend unless another keeps clearly more room.
    if (clear > bestClear + 4) { bestClear = clear; best = c; }
  }
  return best;
}

type WebPoint = (event: ReactMouseEvent<SVGElement>) => void;

function WebNode({ placed, group, scale, subject, dim, appIcons, onEnter, onLeave }: {
  readonly placed: Placed;
  readonly group: Group;
  readonly scale: number;
  readonly subject: boolean;
  readonly dim: boolean;
  readonly appIcons: AppIconMap;
  readonly onEnter: WebPoint;
  readonly onLeave: () => void;
}) {
  const { app, x, y } = placed;
  const seconds = app.seconds[group];
  const r = nodeRadius(seconds, scale);
  const [icon, onError] = useShownIcon(app, appIcons);
  return (
    <g className={"rp-web__node is-" + app.kind + (seconds === 0 ? " is-ghost" : "") + (subject ? " is-subject" : "") + (placed.hub ? " is-hub" : "") + (dim ? " is-dim" : "")} data-app={app.id} data-size={(r * 1.24).toFixed(1)} onMouseEnter={onEnter} onMouseMove={onEnter} onMouseLeave={onLeave}>
      <circle className="rp-web__halo" cx={x.toFixed(1)} cy={y.toFixed(1)} r={(r + 3.5).toFixed(1)} />
      <circle className="rp-web__ring" cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(1)} />
      {icon ? <SvgIcon src={icon} x={x} y={y} size={r * 1.24} onError={onError} /> : (
        <>
          <text className="rp-web__glyph" fontSize="12" x={x.toFixed(1)} y={y.toFixed(1)} dy="0.35em" textAnchor="middle">{app.glyph}</text>
          {app.glyph === app.label ? null : <text className="rp-web__name" fontSize="11.5" x={x.toFixed(1)} y={(y + r + 15).toFixed(1)} textAnchor="middle">{app.label}</text>}
        </>
      )}
    </g>
  );
}

/** Links a list row points at; the picture dims the rest while the row is hovered. */
type Highlight = ReadonlySet<string> | null;

const KIND_COLOR: Record<Kind, string> = { focus: "var(--productivity-focus)", neutral: "var(--productivity-neutral)", drift: "var(--productivity-drift)" };

/** What the pointer is on in the web: an app, or one line. */
type WebTarget = { readonly kind: "app"; readonly id: string } | { readonly kind: "edge"; readonly key: string };

function SwitchGraph({ evidence, group, names, subjectId, highlight, appIcons, ariaLabel }: {
  readonly evidence: ReadSplitEvidence;
  readonly group: Group;
  readonly names: readonly [string, string];
  readonly subjectId: string | undefined;
  readonly highlight: Highlight;
  readonly appIcons: AppIconMap;
  readonly ariaLabel: string;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const gradient = "rp-edge-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ readonly target: WebTarget; readonly x: number; readonly y: number } | null>(null);
  const other: Group = group === 0 ? 1 : 0;
  const switches = evidence.switches ?? [];
  const { placed, geometry: g } = placeApps(evidence.apps ?? [], switches, subjectId);
  const radius = (id: string) => nodeRadius(placed.get(id)!.app.seconds[group], g.scale);
  const nodes = [...placed.values()].map((entry) => ({ id: entry.app.id, x: entry.x, y: entry.y, r: radius(entry.app.id) + 4 }));
  const among = switches.filter((edge) => placed.has(edge.a) && placed.has(edge.b));
  // Line weight is the share of the busiest line across both groups, so the two sides stay comparable.
  const busiest = Math.max(1, ...among.flatMap((edge) => edge.perDay));
  const shown = among.filter((edge) => edge.perDay[group] > 0).sort((a, b) => b.perDay[group] - a.perDay[group]);
  const touches = (edge: ReadSwitch, id: string | undefined) => id !== undefined && (edge.a === id || edge.b === id);
  const edges = shown.filter((edge, index) => index < WEB_EDGE_MAX || touches(edge, subjectId)).reverse();

  const keyOf = (edge: ReadSwitch) => edge.a + "-" + edge.b;
  const pointed = focus?.target;
  const active: Highlight = highlight
    ?? (pointed?.kind === "app" ? new Set(edges.filter((edge) => touches(edge, pointed.id)).map(keyOf))
      : pointed?.kind === "edge" ? new Set([pointed.key]) : null);
  const lit = new Set(edges.filter((edge) => active?.has(keyOf(edge))).flatMap((edge) => [edge.a, edge.b]));
  if (pointed?.kind === "app") lit.add(pointed.id);
  const curves = edges.map((edge, index) => {
    const a = placed.get(edge.a)!;
    const b = placed.get(edge.b)!;
    const c = bendFor(a, b, nodes.filter((node) => node.id !== edge.a && node.id !== edge.b), g);
    const start = rim(a, radius(edge.a), c.x, c.y);
    const end = rim(b, radius(edge.b), c.x, c.y);
    const key = keyOf(edge);
    const state = active === null ? "" : active.has(key) ? " is-lit" : " is-dim";
    const share = Math.sqrt(edge.perDay[group] / busiest);
    return { key, id: gradient + "-" + index, start, end, c, from: a.app.kind, to: b.app.kind, state, count: edge.perDay[group], width: 1 + 4 * share, opacity: 0.22 + 0.5 * share };
  });

  const point = (target: WebTarget) => (event: ReactMouseEvent<SVGElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setFocus({ target, x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const leave = () => setFocus(null);
  const dur = (seconds: number) => durationLabel(seconds, effectiveLanguage);
  const tip = (() => {
    if (!pointed) return null;
    if (pointed.kind === "app") {
      const app = placed.get(pointed.id)?.app;
      if (!app) return null;
      // Every switch the app took part in, drawn or not, so the count matches the card's totals.
      const count = switches.filter((edge) => touches(edge, app.id)).reduce((sum, edge) => sum + edge.perDay[group], 0);
      return { name: app.label, here: dur(app.seconds[group]) + " · " + t("trends.read.web.switches", { count: String(count) }), there: dur(app.seconds[other]) };
    }
    const edge = edges.find((entry) => keyOf(entry) === pointed.key);
    if (!edge) return null;
    return { name: placed.get(edge.a)!.app.label + " ↔ " + placed.get(edge.b)!.app.label, here: t("trends.read.web.perDay", { count: String(edge.perDay[group]) }), there: t("trends.read.web.perDay", { count: String(edge.perDay[other]) }) };
  })();
  const half = 100;
  const boxWidth = boxRef.current?.clientWidth ?? 0;
  const tipX = focus ? Math.min(Math.max(focus.x, half), Math.max(half, boxWidth - half)) : 0;

  return (
    <div className="rp-web-box" ref={boxRef}>
      <svg className={"rp-web" + (active ? " is-focused" : "") + (g.scale < 1 ? " is-dense" : "")} viewBox={"0 0 " + g.w + " " + g.h} role="img" aria-label={ariaLabel}>
        <defs>
          {curves.map(({ id, start, end, from, to }) => (
            <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={start.x.toFixed(1)} y1={start.y.toFixed(1)} x2={end.x.toFixed(1)} y2={end.y.toFixed(1)}>
              <stop offset="0" style={{ stopColor: KIND_COLOR[from] }} />
              <stop offset="1" style={{ stopColor: KIND_COLOR[to] }} />
            </linearGradient>
          ))}
        </defs>
        {curves.map(({ key, id, start, end, c, state, width, opacity }) => {
          const d = "M" + start.x.toFixed(1) + " " + start.y.toFixed(1) + "Q" + c.x.toFixed(1) + " " + c.y.toFixed(1) + " " + end.x.toFixed(1) + " " + end.y.toFixed(1);
          return (
            <g key={key} className={"rp-web__line" + state} data-edge={key}>
              <path className="rp-web__edge" d={d} style={{ stroke: "url(#" + id + ")", strokeWidth: width, "--o": opacity.toFixed(2) } as CSSProperties} />
              <path className="rp-web__hit" d={d} onMouseEnter={point({ kind: "edge", key })} onMouseMove={point({ kind: "edge", key })} onMouseLeave={leave} />
            </g>
          );
        })}
        {curves.flatMap(({ key, start, end, from, to, state }) => [[start, from], [end, to]].map(([spot, kind], index) => (
          <circle key={key + index} className={"rp-web__end" + state} cx={(spot as Point).x.toFixed(1)} cy={(spot as Point).y.toFixed(1)} r="2.2" style={{ fill: KIND_COLOR[kind as Kind] }} />
        )))}
        {[...placed.values()].map((entry) => (
          <WebNode
            key={entry.app.id}
            placed={entry}
            group={group}
            scale={g.scale}
            subject={entry.app.id === subjectId}
            dim={active !== null && !lit.has(entry.app.id)}
            appIcons={appIcons}
            onEnter={point({ kind: "app", id: entry.app.id })}
            onLeave={leave}
          />
        ))}
      </svg>
      {focus && tip ? (
        <div className="rp-tip" role="tooltip" style={{ left: tipX, top: focus.y, "--caret-shift": focus.x - tipX + "px" } as CSSProperties}>
          <b>{tip.name}</b>
          <span>{names[group] + " " + tip.here}</span>
          <span className="is-other">{names[other] + " " + tip.there}</span>
        </div>
      ) : null}
    </div>
  );
}

type LinkRow = { readonly key: string; readonly apps: readonly ReadApp[]; readonly name: string; readonly count: number; readonly other: number; readonly kind: Kind };

/**
 * One of the subject's links as Your usage lists its apps: icon, name, this
 * side's count, and under them a bar. The other side is the same quiet "vs"
 * the measures use, beside the count and as a tick on the bar; there is no
 * signed change chip (it repeated the comparison the card's lead figure makes).
 */
function LinkLine({ row, max, appIcons, onPoint }: { readonly row: LinkRow; readonly max: number; readonly appIcons: AppIconMap; readonly onPoint: (keys: Highlight) => void }) {
  const { t } = useLocalization();
  const share = (value: number) => (max === 0 ? 0 : (value / max) * 100).toFixed(1) + "%";
  return (
    <div className={"rp-link is-" + row.kind} role="row" onMouseEnter={() => onPoint(new Set([row.key]))} onMouseLeave={() => onPoint(null)}>
      <span className="rp-link__icons" aria-hidden="true">{row.apps.map((app) => <ListIcon key={app.id} app={app} appIcons={appIcons} />)}</span>
      <span className="rp-link__name" role="cell" title={row.name}>{row.name}</span>
      <span className="rp-link__value" role="cell">{row.count}</span>
      <span className="rp-link__vs" role="cell">{t("trends.read.tile.vs", { value: String(row.other) })}</span>
      <span className="rp-link__bar" aria-hidden="true"><i style={{ width: share(row.count) }} /><b style={{ left: share(row.other) }} /></span>
    </div>
  );
}

export function SwitchingView({ read, group, appIcons, head, limit = 5, sums: showSums = true }: {
  readonly read: InsightsRead;
  readonly group: Group;
  readonly appIcons: AppIconMap;
  readonly head?: ReactNode;
  /** How many of the subject's links to list, and whether the three totals follow. */
  readonly limit?: number;
  readonly sums?: boolean;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [highlight, setHighlight] = useState<Highlight>(null);
  const evidence = read.evidence;
  const totals = switchTotals(read);
  if (evidence?.kind !== "split" || !totals) return null;
  const other: Group = group === 0 ? 1 : 0;
  const names = [localize(evidence.groups[0].label, effectiveLanguage), localize(evidence.groups[1].label, effectiveLanguage)] as const;
  const apps = new Map((evidence.apps ?? []).map((app) => [app.id, app]));
  const subject = (evidence.apps ?? []).find((app) => app.label === read.subject?.label);
  const switches = (evidence.switches ?? []).filter((edge) => apps.has(edge.a) && apps.has(edge.b) && Math.max(edge.perDay[0], edge.perDay[1]) > 0);

  // With a subject, the list is the subject's links named by the app at the other end; without one, the busiest links.
  const rows: LinkRow[] = (subject ? switches.filter((edge) => edge.a === subject.id || edge.b === subject.id) : switches)
    .map((edge) => {
      const ends = [apps.get(edge.a)!, apps.get(edge.b)!];
      const shown = subject ? ends.filter((app) => app.id !== subject.id) : ends;
      const drift = ends.some((app) => app.kind === "drift");
      return {
        key: edge.a + "-" + edge.b,
        apps: shown,
        name: shown.map((app) => app.label).join(" ↔ "),
        count: edge.perDay[group],
        other: edge.perDay[other],
        kind: drift ? "drift" : ends.every((app) => app.kind === "focus") ? "focus" : "neutral",
      } satisfies LinkRow;
    })
    .sort((a, b) => b.count - a.count || b.other - a.other)
    .slice(0, limit);
  const max = Math.max(1, ...rows.map((row) => Math.max(row.count, row.other)));
  const keysOf = (keep: (a: ReadApp, b: ReadApp) => boolean) => new Set(switches.filter((edge) => keep(apps.get(edge.a)!, apps.get(edge.b)!)).map((edge) => edge.a + "-" + edge.b));
  const sums: { key: string; name: string; values: readonly [number, number]; keys: Highlight }[] = [
    ...(subject ? [{ key: "subject", name: t("trends.read.links.subject", { subject: subject.label }), values: totals.subject, keys: keysOf((a, b) => a.id === subject.id || b.id === subject.id) }] : []),
    { key: "work", name: t("trends.read.links.work"), values: totals.work, keys: keysOf((a, b) => a.kind !== "drift" && b.kind !== "drift") },
    { key: "total", name: t("trends.read.links.total"), values: totals.total, keys: null },
  ];

  // The graph needs no legend: classes keep the app's colours, and every circle and line names itself on hover.
  return (
    <>
      {head}
      <div className="rp-switch">
        <figure className="rp-switch__graph">
          <SwitchGraph evidence={evidence} group={group} names={names} subjectId={subject?.id} highlight={highlight} appIcons={appIcons} ariaLabel={t("trends.read.graphAria", { group: names[group] })} />
        </figure>
        <div className="rp-links" role="table" aria-label={t("trends.read.linksAria", { group: names[group], other: names[other] })}>
          <p className="rp-links__head">{subject ? t("trends.read.links.with", { subject: subject.label }) : t("trends.read.links.top")}</p>
          {rows.map((row) => <LinkLine key={row.key} row={row} max={max} appIcons={appIcons} onPoint={setHighlight} />)}
          {showSums ? <div className="rp-links__sum" role="rowgroup">
            {sums.map((sum) => (
              <div key={sum.key} className="rp-link is-sum" role="row" onMouseEnter={() => setHighlight(sum.keys)} onMouseLeave={() => setHighlight(null)}>
                <span className="rp-link__name" role="cell">{sum.name}</span>
                <span className="rp-link__value" role="cell">{sum.values[group]}</span>
                <span className="rp-link__vs" role="cell">{t("trends.read.tile.vs", { value: String(sum.values[other]) })}</span>
              </div>
            ))}
          </div> : null}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ time flow */

const SCALE = 0.42; // px per minute
const GAP = 4;
const CLASS_GAP = 14;
/** Room above the first bar, for the first app's name. */
const TOP = 4;
const BAR = 10;
/** Each app gets at least this much height, enough for its name with its time and share under it, the way Dayflow labels its apps. */
const ROW = 30;
/** Apps named in time flow per class; the rest of the class is one "Other" row, as in Dayflow. */
export const FLOW_PER_CLASS = 4;
/**
 * The flow is drawn at the card's own width, one viewBox unit to one CSS
 * pixel, so its type keeps its size in every layout. As in Dayflow, the day
 * starts as one total bar at the card's left edge and splits into its
 * classes, which split into their apps. The total and each class are named
 * just right of their bars, over their own ribbons; the app labels (name,
 * then time and share of the day under it) end at the card's right edge,
 * and the ribbons take the width between. Before layout (and in tests) it
 * assumes this width.
 */
const FLOW_FALLBACK_WIDTH = 580;
const ICON = 18;
/** Room between the total's or a class's label and the next bars, so the label never runs into them. */
const CLASS_LABEL_ROOM = 40;

/** The width a flow is laid out at and the font its labels are set in, once it is on the page. */
function useFlowBox(): readonly [RefObject<HTMLDivElement>, number, string | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ readonly width: number; readonly family: string | null }>({ width: FLOW_FALLBACK_WIDTH, family: null });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      const width = Math.round(element.clientWidth);
      if (width > 0) setBox((current) => (current.width === width && current.family ? current : { width, family: getComputedStyle(element).fontFamily || null }));
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, box.width, box.family];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** How wide a label sets, measured in the page's font once laid out; before that, a close estimate per character. */
function setWidth(text: string, weight: number, size: number, family: string | null): number {
  if (family) {
    if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d");
    if (measureContext) {
      measureContext.font = weight + " " + size + "px " + family;
      return measureContext.measureText(text).width;
    }
  }
  let em = 0;
  for (const char of text) em += /[\u3131-\uD7A3]/.test(char) ? 1 : /[0-9]/.test(char) ? 0.6 : char === " " ? 0.28 : /[A-Z]/.test(char) ? 0.68 : 0.56;
  return em * size * (weight >= 600 ? 1.04 : 1);
}
function ribbon(x0: number, a0: number, b0: number, x1: number, a1: number, b1: number): string {
  const xm = (x0 + x1) / 2;
  return "M" + x0 + " " + a0.toFixed(1) + "C" + xm + " " + a0.toFixed(1) + " " + xm + " " + a1.toFixed(1) + " " + x1 + " " + a1.toFixed(1)
    + "L" + x1 + " " + b1.toFixed(1) + "C" + xm + " " + b1.toFixed(1) + " " + xm + " " + b0.toFixed(1) + " " + x0 + " " + b0.toFixed(1) + "Z";
}

/** An app's icon beside its name in the flow; nothing for the "other" row, whose name is the app's. */
function FlowIcon({ app, x, y, appIcons }: { readonly app: ReadApp; readonly x: number; readonly y: number; readonly appIcons: AppIconMap }) {
  const [icon, onError] = useShownIcon(app, appIcons);
  if (app.id === "other" || app.id.startsWith("other-")) return null;
  return (
    <g className="rp-flow__icon" data-app={app.id} data-size={ICON}>
      {icon ? <SvgIcon src={icon} x={x + ICON / 2} y={y} size={ICON} onError={onError} /> : (
        <>
          <rect className="rp-flow__glyph-tile" x={x} y={(y - ICON / 2).toFixed(1)} width={ICON} height={ICON} rx="4" />
          <text className="rp-flow__glyph" fontSize="9.5" x={x + ICON / 2} y={y.toFixed(1)} dy="0.35em" textAnchor="middle">{app.glyph}</text>
        </>
      )}
    </g>
  );
}

/** What the pointer is on in the flow: the total, a class, or one app. */
type FlowTarget = { readonly kind: "total" } | { readonly kind: "class"; readonly cls: Kind } | { readonly kind: "app"; readonly cls: Kind; readonly id: string };
/** Half the tooltip's likely width, so a tooltip near either edge of the card stays inside it. */
const FLOW_TIP_HALF = 110;

export function TimeFlowView({ read, group, appIcons, head }: {
  readonly read: InsightsRead;
  readonly group: Group;
  readonly appIcons: AppIconMap;
  readonly head?: ReactNode;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [boxRef, width, family] = useFlowBox();
  const [focus, setFocus] = useState<{ readonly target: FlowTarget; readonly x: number; readonly y: number } | null>(null);
  const evidence = read.evidence;
  if (evidence?.kind !== "split" || !evidence.apps?.length) return null;
  const other: Group = group === 0 ? 1 : 0;
  const names = [localize(evidence.groups[0].label, effectiveLanguage), localize(evidence.groups[1].label, effectiveLanguage)] as const;
  const minutes = (app: ReadApp, g: Group) => app.seconds[g] / MINUTE;
  const bar = (m: number) => Math.max(4, m * SCALE);

  // Each class shows its FLOW_PER_CLASS biggest apps; a heavier week's rest of the class joins one "Other" row.
  const byKind = KINDS.map((kind) => {
    const all = evidence.apps!.filter((app) => app.kind === kind);
    const named = all.filter((app) => app.id !== "other" && app.seconds[group] > 0).sort((a, b) => b.seconds[group] - a.seconds[group]);
    const top = named.slice(0, FLOW_PER_CLASS);
    const rest = all.filter((app) => !top.includes(app));
    if (rest.length === 0) return { kind, apps: top };
    if (rest.length === 1 && rest[0].seconds[group] > 0 && rest[0].id === "other") return { kind, apps: [...top, rest[0]] };
    const merged: ReadApp = { id: "other-" + kind, label: "Other", glyph: "·", kind, seconds: [rest.reduce((sum, app) => sum + app.seconds[0], 0), rest.reduce((sum, app) => sum + app.seconds[1], 0)] };
    return { kind, apps: merged.seconds[group] > 0 ? [...top, merged] : top };
  }).filter((entry) => entry.apps.length > 0);
  const kindTotal = (kind: Kind) => evidence.apps!.filter((app) => app.kind === kind).reduce((sum, app) => sum + minutes(app, group), 0);
  const kindTotalOther = (kind: Kind) => evidence.apps!.filter((app) => app.kind === kind).reduce((sum, app) => sum + minutes(app, other), 0);
  const total = KINDS.reduce((sum, kind) => sum + kindTotal(kind), 0);
  const totalOther = KINDS.reduce((sum, kind) => sum + kindTotalOther(kind), 0);

  // Each app takes a slot at least one label tall, its bar centred in the slot; each class bar sits centred on its apps.
  let y = TOP;
  const appRows: { app: ReadApp; y: number; h: number; mid: number }[] = [];
  const span = new Map<Kind, { start: number; end: number }>();
  for (const { kind, apps } of byKind) {
    const start = y;
    for (const app of apps) {
      const h = bar(minutes(app, group));
      const slot = Math.max(h, ROW);
      appRows.push({ app, y: y + (slot - h) / 2, h, mid: y + slot / 2 });
      y += slot + GAP;
    }
    span.set(kind, { start, end: y - GAP });
    y += CLASS_GAP - GAP;
  }
  const bottom = y - CLASS_GAP;
  const classBars = new Map<Kind, { y: number; h: number }>();
  let previous = -Infinity;
  for (const { kind } of byKind) {
    const h = kindTotal(kind) * SCALE;
    const { start, end } = span.get(kind)!;
    const top = Math.max((start + end) / 2 - h / 2, previous + 14);
    classBars.set(kind, { y: top, h });
    previous = top + h;
  }
  const height = Math.ceil(Math.max(bottom, previous) + 2);

  // The total bar is the day the classes add up to, centred on them.
  const firstClass = classBars.get(byKind[0].kind)!;
  const lastClass = classBars.get(byKind[byKind.length - 1].kind)!;
  const dayH = total * SCALE;
  const dayY = (firstClass.y + lastClass.y + lastClass.h) / 2 - dayH / 2;

  const pct = (m: number) => Math.round((m / total) * 100) + "%";
  // Under each app's name: its time and its share of the average day, as its class shows them. No change against
  // the other side here; the lead figure and the measures carry the comparison, and hovering names both sides.
  const labels = appRows.map((row) => {
    const m = minutes(row.app, group);
    return {
      row,
      m,
      otherMinutes: minutes(row.app, other),
      name: row.app.id === "other" || row.app.id.startsWith("other-") ? t("trends.read.flow.other") : row.app.label,
      sub: durationLabel(m * MINUTE, effectiveLanguage) + " · " + pct(m),
    };
  });
  const classLabels = byKind.map(({ kind }) => ({ kind, name: t(kindLabelKey(kind)), sub: durationLabel(kindTotal(kind) * MINUTE, effectiveLanguage) + " · " + pct(kindTotal(kind)) }));
  const totalLabel = {
    name: t("trends.read.flow.total"),
    sub: t("trends.read.flow.totalSub", { value: durationLabel(total * MINUTE, effectiveLanguage), count: String(evidence.groups[group].dates.length) }),
  };
  // The app column is as wide as its longest label, and ends at the right edge.
  const appLabelWidth = Math.max(...labels.map((label) => Math.max(
    setWidth(label.name, 600, 13, family),
    setWidth(label.sub, 400, 11.5, family),
  ))) + 2;
  const classLabelWidth = Math.max(...classLabels.map((label) => Math.max(setWidth(label.name, 600, 13.5, family), setWidth(label.sub, 400, 12, family))));
  const totalLabelWidth = Math.max(setWidth(totalLabel.name, 600, 13.5, family), setWidth(totalLabel.sub, 400, 12, family));
  const dayX = 0;
  const dayLabelX = dayX + BAR + 10;
  // The class bars sit halfway between the total and the app bars, so both splits get the same length, unless the
  // total's label or the class labels need the room.
  const appRight = width - (BAR + 10 + ICON + 8 + appLabelWidth);
  const classX = Math.max(
    dayLabelX + totalLabelWidth + CLASS_LABEL_ROOM,
    Math.min((dayX + appRight) / 2, appRight - (BAR + 10 + classLabelWidth + CLASS_LABEL_ROOM)),
  );
  const labelX = classX + BAR + 10;
  const appX = Math.max(labelX + classLabelWidth + CLASS_LABEL_ROOM, appRight);
  const iconX = appX + BAR + 10;
  const textX = iconX + ICON + 8;
  const drawnWidth = Math.max(width, Math.ceil(textX + appLabelWidth));

  const ribbons: { key: string; kind: Kind; fromDay: boolean; d: string }[] = [];
  let dayCursor = dayY;
  for (const { kind } of byKind) {
    const cls = classBars.get(kind)!;
    ribbons.push({ key: "day-" + kind, kind, fromDay: true, d: ribbon(dayX + BAR, dayCursor, dayCursor + cls.h, classX, cls.y, cls.y + cls.h) });
    dayCursor += cls.h;
    let classCursor = cls.y;
    for (const row of appRows.filter((entry) => entry.app.kind === kind)) {
      const h = minutes(row.app, group) * SCALE;
      ribbons.push({ key: "app-" + row.app.id, kind, fromDay: false, d: ribbon(classX + BAR, classCursor, classCursor + h, appX, row.y, row.y + row.h) });
      classCursor += h;
    }
  }
  const dayMid = dayY + dayH / 2;

  // Hovering the total, a class or an app lights its path through the flow, dims the rest, and names both sides
  // in a tooltip shaped like Your usage's focus calendar tooltip.
  const dur = (m: number) => durationLabel(m * MINUTE, effectiveLanguage);
  const point = (target: FlowTarget) => (event: ReactMouseEvent<SVGElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setFocus({ target, x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const hover = (target: FlowTarget) => ({ onMouseEnter: point(target), onMouseMove: point(target), onMouseLeave: () => setFocus(null) });
  const lit = focus?.target;
  const ribbonLit = (entry: { key: string; kind: Kind; fromDay: boolean }) =>
    !lit || lit.kind === "total" ? false
      : lit.kind === "class" ? entry.kind === lit.cls
        : entry.fromDay ? entry.kind === lit.cls : entry.key === "app-" + lit.id;
  const classLit = (kind: Kind) => Boolean(lit && lit.kind !== "total" && lit.cls === kind);
  const appLit = (app: ReadApp) => Boolean(lit && (lit.kind === "class" ? lit.cls === app.kind : lit.kind === "app" && lit.id === app.id));
  const tip = (() => {
    if (!lit) return null;
    if (lit.kind === "total") return { name: totalLabel.name, here: dur(total), there: dur(totalOther) };
    if (lit.kind === "class") return { name: t(kindLabelKey(lit.cls)), here: dur(kindTotal(lit.cls)) + " · " + pct(kindTotal(lit.cls)), there: dur(kindTotalOther(lit.cls)) };
    const label = labels.find((entry) => entry.row.app.id === lit.id);
    return label ? { name: label.name, here: dur(label.m) + " · " + pct(label.m), there: dur(label.otherMinutes) } : null;
  })();
  const tipX = focus ? Math.min(Math.max(focus.x, FLOW_TIP_HALF), Math.max(FLOW_TIP_HALF, width - FLOW_TIP_HALF)) : 0;
  const focusedLit = Boolean(lit && lit.kind !== "total");

  return (
    <>
      {head}
      <div className="rp-flow-box" ref={boxRef}>
      <svg className={"rp-flow" + (focusedLit ? " is-focused" : "")} width={drawnWidth} height={height} viewBox={"0 0 " + drawnWidth + " " + height} role="img" aria-label={t("trends.read.flowAria", { group: names[group] })}>
        {ribbons.map((entry) => {
          const owner = entry.key.startsWith("app-") ? appRows.find((row) => "app-" + row.app.id === entry.key)?.app : undefined;
          const target: FlowTarget = owner ? { kind: "app", cls: entry.kind, id: owner.id } : { kind: "class", cls: entry.kind };
          return <path key={entry.key} className={"rp-flow__ribbon is-" + entry.kind + (entry.fromDay ? " is-from-day" : "") + (ribbonLit(entry) ? " is-lit" : "")} d={entry.d} {...hover(target)} />;
        })}
        <g className="rp-flow__total" {...hover({ kind: "total" })}>
          <rect className="rp-flow__hit" x={dayX} y={dayY.toFixed(1)} width={(dayLabelX + totalLabelWidth + 8).toFixed(1)} height={dayH.toFixed(1)} />
          <rect className="rp-flow__day" x={dayX} y={dayY.toFixed(1)} width={BAR} height={dayH.toFixed(1)} rx="2" />
          <text className="rp-flow__label is-strong" fontSize="13.5" x={dayLabelX} y={(dayMid - 7).toFixed(1)}>{totalLabel.name}</text>
          <text className="rp-flow__label is-soft" fontSize="12" x={dayLabelX} y={(dayMid + 9).toFixed(1)}>{totalLabel.sub}</text>
        </g>
        {classLabels.map(({ kind, name, sub }) => {
          const cls = classBars.get(kind)!;
          const mid = cls.y + cls.h / 2;
          const hitTop = Math.min(cls.y, mid - 20);
          const hitBottom = Math.max(cls.y + cls.h, mid + 16);
          return (
            <g key={kind} className={"rp-flow__class" + (classLit(kind) ? " is-lit" : "")} data-kind={kind} {...hover({ kind: "class", cls: kind })}>
              <rect className="rp-flow__hit" x={classX - 4} y={hitTop.toFixed(1)} width={(BAR + 10 + classLabelWidth + 12).toFixed(1)} height={(hitBottom - hitTop).toFixed(1)} />
              <rect className={"rp-flow__bar is-" + kind} x={classX} y={cls.y.toFixed(1)} width={BAR} height={cls.h.toFixed(1)} rx="2" />
              <text className="rp-flow__label is-strong" fontSize="13.5" x={labelX} y={(mid - 7).toFixed(1)}>{name}</text>
              <text className="rp-flow__label is-soft" fontSize="12" x={labelX} y={(mid + 9).toFixed(1)}>{sub}</text>
            </g>
          );
        })}
        {labels.map(({ row, name, sub }) => {
          const slot = Math.max(row.h, ROW) + GAP;
          return (
          <g key={row.app.id} className={"rp-flow__app" + (appLit(row.app) ? " is-lit" : "")} {...hover({ kind: "app", cls: row.app.kind, id: row.app.id })}>
            <rect className="rp-flow__hit" x={(appX - 4).toFixed(1)} y={(row.mid - slot / 2).toFixed(1)} width={(drawnWidth - appX + 4).toFixed(1)} height={slot.toFixed(1)} />
            <rect className={"rp-flow__bar is-" + row.app.kind} x={appX.toFixed(1)} y={row.y.toFixed(1)} width={BAR} height={row.h.toFixed(1)} rx="2" />
            <FlowIcon app={row.app} x={iconX} y={row.mid - 6} appIcons={appIcons} />
            <text className="rp-flow__label is-strong" fontSize="13" x={textX.toFixed(1)} y={(row.mid - 6).toFixed(1)} dy="0.35em">{name}</text>
            <text className="rp-flow__label is-soft is-num" fontSize="11.5" x={textX.toFixed(1)} y={(row.mid + 8.5).toFixed(1)} dy="0.35em">{sub}</text>
          </g>
          );
        })}
      </svg>
      {focus && tip ? (
        <div className="rp-tip" role="tooltip" style={{ left: tipX, top: focus.y, "--caret-shift": focus.x - tipX + "px" } as CSSProperties}>
          <b>{tip.name}</b>
          <span>{names[group] + " " + tip.here}</span>
          <span className="is-other">{names[other] + " " + tip.there}</span>
        </div>
      ) : null}
      </div>
    </>
  );
}
