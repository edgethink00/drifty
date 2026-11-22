import { useEffect, useState } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import { GlyphMark, textWidth, useAchievementFigure, useArtId } from "./achievementMarks";

function ticks(major: boolean, lit: (turn: number) => boolean = () => true): string {
  return Array.from({ length: 60 }, (_, index) => index)
    .filter((index) => (index % 5 === 0) === major && lit(index / 60))
    .map((index) => {
      const angle = (index / 60) * Math.PI * 2;
      const outer = 56;
      const inner = major ? 49 : 52.5;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      return "M" + (75 + outer * sin).toFixed(2) + " " + (75 - outer * cos).toFixed(2) + "L" + (75 + inner * sin).toFixed(2) + " " + (75 - inner * cos).toFixed(2);
    })
    .join("");
}

const MINOR = ticks(false);
const MAJOR = ticks(true);

/** Counts the figure up from zero as the new-achievement card opens. */
function useCountUp(value: string, active: boolean): string {
  const target = /^\d+$/u.test(value) ? Number(value) : null;
  const counting = active && target !== null;
  const [shown, setShown] = useState<number | null>(counting ? 0 : null);
  useEffect(() => {
    if (!active || target === null) {
      setShown(null);
      return undefined;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now() + 520;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / 1100));
      setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, target]);
  return counting && shown !== null ? String(shown) : value;
}

/**
 * How much of the dial each figure fills: minutes on an hour, hours on twelve,
 * a share of the day; clock times mark their hour instead.
 */
const DIAL: Record<AchievementId, { readonly sweep?: number; readonly hours?: readonly [number, number] }> = {
  firstFlow: { sweep: 25 / 60 },
  flow90: { sweep: 90 / 60 },
  flow180: { sweep: 3 / 12 },
  focusDay8h: { sweep: 8 / 12 },
  earlyStart: { hours: [5, 7] },
  nightOwl: { hours: [2, 5] },
  weekendShift: { sweep: 4 / 12 },
  streak7: { sweep: 1 },
  streak30: { sweep: 1 },
  focus100h: { sweep: 2 },
  driftDay: { sweep: 0.5 },
  noDriftDay: { sweep: 0 },
  comeback: { sweep: 4 / 12 },
};

function dialPoint(radius: number, turn: number): readonly [number, number] {
  const angle = turn * Math.PI * 2;
  return [75 + radius * Math.sin(angle), 75 - radius * Math.cos(angle)];
}

function arc(radius: number, from: number, to: number): string {
  const point = (turn: number) => dialPoint(radius, turn).map((value) => value.toFixed(2)).join(" ");
  if (to - from >= 0.999) return "M75 " + (75 - radius) + "a" + radius + " " + radius + " 0 1 1 -0.01 0Z";
  return "M" + point(from) + "A" + radius + " " + radius + " 0 " + (to - from > 0.5 ? 1 : 0) + " 1 " + point(to);
}

/**
 * The figure itself, set large on a watch dial: 90 minutes, 8 hours, 30 days.
 * Earned, the dial closes into a ring in the achievement's colour; each
 * milestone lights one pip under the figure.
 */
export function AchievementNumeral({ id, group, state, tier, entrance = false }: AchievementArtProps) {
  const uid = useArtId("achievement-numeral");
  const earned = state === "earned";
  const figure = useAchievementFigure(id);
  const counted = useCountUp(figure.value, entrance && state === "earned");
  const pips = earned && tier > 0 ? Math.min(tier, 4) : 0;
  const unitSize = textWidth(figure.unit, 1) > 1.2 ? 11.5 : 15;
  const size = Math.min(42, (78 - textWidth(figure.unit, unitSize)) / (figure.value.length * 0.64));
  const dial = DIAL[id];
  const sweep = dial.sweep ?? 0;
  const end = dial.hours ? dial.hours[1] / 12 : sweep > 0 && sweep < 1 ? sweep : null;
  const tip = end === null ? null : dialPoint(60, end);
  const lit = (turn: number) => dial.hours ? turn >= dial.hours[0] / 12 - 0.001 && turn <= dial.hours[1] / 12 + 0.001 : turn <= sweep + 0.001 && sweep > 0;
  return (
    <svg className="achievement-art achievement-numeral" viewBox="0 0 150 150" data-group={group} data-state={state} data-stone={id} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={uid + "-glass"} cx="50%" cy="18%" r="75%">
          <stop offset="0" className="an-glass" />
          <stop offset="1" style={{ stopColor: "white", stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <rect className="an-tile" x="0" y="0" width="150" height="150" rx="38" />
      {earned ? <rect x="0" y="0" width="150" height="150" rx="38" style={{ fill: "url(#" + uid + "-glass)" }} /> : null}
      <path className="an-ticks" d={MINOR} />
      <path className="an-ticks an-ticks--major" d={MAJOR} />
      {earned ? <path className="an-ticks an-ticks--lit" d={ticks(false, lit) + ticks(true, lit)} /> : null}
      {earned ? <circle className="an-ring" cx="75" cy="75" r="60" pathLength={1} transform="rotate(-90 75 75)" /> : null}
      {earned && sweep > 0 ? <path className="an-sweep" pathLength={1} d={arc(60, 0, Math.min(sweep, 1))} /> : null}
      {earned && sweep > 1 ? <path className="an-sweep an-sweep--lap" pathLength={1} d={arc(65, 0, Math.min(sweep - 1, 1))} /> : null}
      {earned && dial.hours ? <path className="an-sweep" pathLength={1} d={arc(60, dial.hours[0] / 12, dial.hours[1] / 12)} /> : null}
      {earned && tip ? <circle className="an-tip" cx={tip[0]} cy={tip[1]} r="3.6" /> : null}
      <GlyphMark className="an-glyph" name={state === "concealed" ? "hidden" : id} x={75} y={47} size={21} />
      {state === "concealed" ? null : (
        <text className="an-figure" x="75" y={83 + size * 0.38} fontSize={size.toFixed(1)} textAnchor="middle">
          {counted}
          <tspan className="an-unit" fontSize={unitSize} dx="1.5">{figure.unit}</tspan>
        </text>
      )}
      {pips > 0 ? Array.from({ length: 4 }, (_, index) => (
        <circle key={index} className={"an-pip" + (index < pips ? "" : " an-pip--off")} cx={63 + index * 8} cy="113" r="2.2" />
      )) : null}
    </svg>
  );
}
