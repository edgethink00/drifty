import { useMemo } from "react";
import type { AchievementId } from "./achievementCatalog";
import { dialArc, dialPoint, type AchievementArtProps, type AchievementMark } from "./achievementArt";

type DialSpec = {
  /** Marks around the rim, with every nth one drawn longer. */
  readonly ticks: number;
  readonly major: number;
  /** One arc, as turns from twelve o'clock. */
  readonly arc?: readonly [number, number];
  /** Laps of the dial, outermost first; each is the share of the lap covered. */
  readonly laps?: readonly number[];
  /** Equal parts of the ring, some of them lit. */
  readonly segments?: { readonly count: number; readonly lit: readonly number[] };
  /** The arc wanders instead of holding its radius. */
  readonly wave?: boolean;
  /** The rim itself is lit. */
  readonly litRim?: boolean;
};

const all = (count: number) => Array.from({ length: count }, (_, index) => index);

/** Each dial is read the way its goal is measured: minutes round an hour, hours round a day, days round a week or a month. */
const DIALS: Record<AchievementId, DialSpec> = {
  firstFlow: { ticks: 60, major: 5, arc: [0, 25 / 60] },
  flow90: { ticks: 60, major: 5, laps: [1, 0.5] },
  flow180: { ticks: 60, major: 5, laps: [1, 1, 1] },
  focusDay8h: { ticks: 48, major: 2, arc: [8 / 24, 16 / 24] },
  earlyStart: { ticks: 48, major: 2, arc: [5 / 24, 7 / 24] },
  nightOwl: { ticks: 48, major: 2, arc: [2 / 24, 5 / 24] },
  weekendShift: { ticks: 28, major: 4, segments: { count: 7, lit: [5, 6] } },
  streak7: { ticks: 28, major: 4, segments: { count: 7, lit: all(7) } },
  streak30: { ticks: 60, major: 2, segments: { count: 30, lit: all(30) } },
  focus100h: { ticks: 100, major: 10, arc: [0, 1], litRim: true },
  driftDay: { ticks: 60, major: 5, arc: [0, 0.5], wave: true },
  noDriftDay: { ticks: 60, major: 5, arc: [0, 1] },
  comeback: { ticks: 48, major: 2, segments: { count: 4, lit: [3] } },
};

const CONCEALED_DIAL: DialSpec = { ticks: 60, major: 5 };
const RING = 35.5;
const LAP_STEP = 5.6;

function ticksPath(spec: DialSpec, major: boolean): string {
  let path = "";
  for (let index = 0; index < spec.ticks; index += 1) {
    if ((index % spec.major === 0) !== major) continue;
    const inner = dialPoint(major ? 42.6 : 44.6, index / spec.ticks);
    const outer = dialPoint(47.4, index / spec.ticks);
    path += "M" + inner[0].toFixed(2) + " " + inner[1].toFixed(2) + "L" + outer[0].toFixed(2) + " " + outer[1].toFixed(2);
  }
  return path;
}

function wavePath(from: number, to: number): string {
  const steps = 72;
  let path = "";
  for (let step = 0; step <= steps; step += 1) {
    const turn = from + ((to - from) * step) / steps;
    const point = dialPoint(RING + 1.9 * Math.sin(turn * Math.PI * 2 * 16), turn);
    path += (step === 0 ? "M" : "L") + point[0].toFixed(2) + " " + point[1].toFixed(2);
  }
  return path;
}

function numeralSize(mark: AchievementMark, laps: number): number {
  // Letters outside Latin, such as 토·일, are set wider than figures.
  if (/[^\u0000-\u00ff]/u.test(mark.text)) return 15;
  const length = mark.text.length + (mark.unit ? 0.6 : 0);
  const fitted = length <= 2 ? 25 : length <= 2.6 ? 21.5 : length <= 3 ? 19 : length <= 3.6 ? 16.5 : 14.5;
  return Math.min(fitted, laps >= 3 ? 15.5 : laps === 2 ? 19 : 25);
}

/** A gauge: a ticked rim, the goal drawn round it, and its figure in the middle. */
export function AchievementDial({ id, group, state, detail, mark }: AchievementArtProps) {
  const spec = state === "concealed" ? CONCEALED_DIAL : DIALS[id];
  const earned = state === "earned";
  const rim = useMemo(() => ({ minor: ticksPath(spec, false), major: ticksPath(spec, true) }), [spec]);
  const laps = spec.laps ?? (spec.segments ? [] : [1]);
  const size = numeralSize(mark, laps.length);
  const lit: { readonly d: string; readonly segment?: boolean }[] = [];
  const tracks: string[] = [];

  if (spec.segments) {
    const { count } = spec.segments;
    const gap = count > 12 ? 0.3 : 0.14;
    for (let index = 0; index < count; index += 1) {
      const d = dialArc(RING, (index + gap / 2) / count, (index + 1 - gap / 2) / count);
      if (earned && spec.segments.lit.includes(index)) lit.push({ d, segment: true });
      else tracks.push(d);
    }
  } else {
    laps.forEach((share, index) => {
      const radius = RING - index * LAP_STEP;
      tracks.push(dialArc(radius, 0, 1) + "Z");
      if (!earned) return;
      if (spec.laps) lit.push({ d: dialArc(radius, 0, share) + (share >= 1 ? "Z" : "") });
      else if (spec.arc) lit.push({ d: spec.wave ? wavePath(spec.arc[0], spec.arc[1]) : dialArc(radius, spec.arc[0], spec.arc[1]) + (spec.arc[1] - spec.arc[0] >= 1 ? "Z" : "") });
    });
  }

  return (
    <svg className="achievement-art achievement-dial" viewBox="0 0 100 100" data-group={group} data-state={state} data-laps={laps.length} data-lit-rim={spec.litRim ? "true" : undefined} aria-hidden="true" focusable="false">
      {detail ? <path className="achievement-dial__tick" d={rim.minor} /> : null}
      {detail ? <path className="achievement-dial__tick achievement-dial__tick--major" d={rim.major} /> : null}
      {tracks.map((d) => <path key={d} className="achievement-dial__track" d={d} />)}
      {lit.map((arc) => <path key={arc.d} className={"achievement-dial__lit" + (arc.segment ? " achievement-dial__lit--segment" : "")} d={arc.d} />)}
      {detail ? (
        <text className="achievement-dial__numeral" x="50" y={50 + size * 0.36} fontSize={size} textAnchor="middle">
          {mark.text}
          {mark.unit ? <tspan className="achievement-dial__unit" fontSize={size * 0.54} dx={size * 0.04}>{mark.unit}</tspan> : null}
        </text>
      ) : null}
    </svg>
  );
}
