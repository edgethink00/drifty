import { useId, type CSSProperties, type ReactNode } from "react";
import type { AchievementArtProps } from "./achievementArt";
import type { AchievementId } from "./achievementCatalog";
import { arcPath, crescentPath, polar, squirclePath } from "./achievementOmo1Shapes";
import "./achievementOmo1.css";

const CX = 60;
const CY = 53;
const PLATE = squirclePath(60, 60, 52);
const PLATE_COMPACT = squirclePath(60, 60, 57);
const ONE_TIME: ReadonlySet<AchievementId> = new Set(["firstFlow", "focus100h"]);
/** Entrance timeline in ms: the chart draws from DRAW, then the milestone notches light from NOTCH. */
const DRAW = 420;
const NOTCH = 1320;
const NOTCH_STEP = 90;

type Mark = "trk" | "val" | "ink" | "cue";
type Motion = "draw" | "pop" | "grow" | "growx" | "rise" | "fade";
type Tone = "focus" | "drift";

function mark(kind: Mark, paint: "s" | "f", motion?: Motion, delay = 0, tone?: Tone) {
  return {
    className: "omo1-" + kind + " omo1-" + paint,
    "data-a": motion,
    "data-tone": tone,
    style: motion ? ({ "--omo1-d": Math.round(delay) } as CSSProperties) : undefined,
  };
}

function Ring({ r, w, to, delay, from = 0 }: { readonly r: number; readonly w: number; readonly to: number; readonly delay: number; readonly from?: number }) {
  return (
    <>
      <circle cx={CX} cy={CY} r={r} strokeWidth={w} {...mark("trk", "s")} />
      <path d={arcPath(CX, CY, r, from, to)} pathLength={1} strokeWidth={w} {...mark("val", "s", "draw", delay)} />
    </>
  );
}

function Tick({ r0, r1, angle, width, kind, delay }: { readonly r0: number; readonly r1: number; readonly angle: number; readonly width: number; readonly kind: Mark; readonly delay?: number }) {
  const [x1, y1] = polar(CX, CY, r0, angle);
  const [x2, y2] = polar(CX, CY, r1, angle);
  return <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={width} {...mark(kind, "s", delay === undefined ? undefined : "fade", delay)} />;
}

function FirstFlow({ compact }: { readonly compact: boolean }) {
  return (
    <>
      <Ring r={compact ? 30 : 27} w={compact ? 15 : 9} to={150} delay={DRAW} />
      {compact ? null : Array.from({ length: 12 }, (_, index) => (
        <Tick key={index} r0={15.5} r1={18.5} angle={index * 30} width={1.6} kind={index <= 5 ? "val" : "ink"} delay={index <= 5 ? DRAW + index * 150 : undefined} />
      ))}
    </>
  );
}

function Flow90({ compact }: { readonly compact: boolean }) {
  return (
    <>
      <Ring r={compact ? 31 : 30} w={compact ? 12 : 8} to={360} delay={DRAW} />
      <Ring r={compact ? 15.5 : 19} w={compact ? 12 : 8} to={180} delay={DRAW + 560} />
    </>
  );
}

function Flow180({ compact }: { readonly compact: boolean }) {
  const radii = compact ? [32, 20, 8] : [31, 22, 13];
  return <>{radii.map((r, index) => <Ring key={r} r={r} w={compact ? 7.5 : 6.5} to={360} delay={DRAW + index * 200} />)}</>;
}

function FocusDay({ compact }: { readonly compact: boolean }) {
  const x = compact ? 17 : 22;
  const width = 120 - 2 * x;
  const h = compact ? 16 : 12;
  const gap = compact ? 6 : 4.5;
  const top = CY - h * 1.5 - gap;
  const rows = [top, top + h + gap, top + 2 * (h + gap)];
  const hour = width / 8;
  const radius = compact ? 3.5 : 2.6;
  const block = (row: number, from: number, to: number, delay: number) => (
    <rect x={x + from * hour} y={rows[row]} width={(to - from) * hour} height={h} rx={radius} {...mark("val", "f", "growx", delay)} />
  );
  return (
    <>
      {rows.map((y) => <rect key={y} x={x} y={y} width={width} height={h} rx={radius} {...mark("trk", "f")} />)}
      {block(0, 6.5, 8, DRAW)}
      {compact
        ? block(1, 0, 8, DRAW + 160)
        : Array.from({ length: 8 }, (_, index) => {
          const cell = (width - 7 * 1.6) / 8;
          return <rect key={index} x={x + index * (cell + 1.6)} y={rows[1]} width={cell} height={h} rx={radius - 0.6} {...mark("val", "f", "pop", DRAW + 160 + index * 80)} />;
        })}
      {block(2, 0, 1.5, DRAW + 860)}
      {compact ? null : block(2, 3.5, 4.25, DRAW + 940)}
    </>
  );
}

function Dial({ compact, from, to, children }: { readonly compact: boolean; readonly from: number; readonly to: number; readonly children: ReactNode }) {
  const r = compact ? 31 : 28;
  return (
    <>
      <circle cx={CX} cy={CY} r={r} strokeWidth={compact ? 5 : 3.5} {...mark("trk", "s")} />
      {compact ? null : Array.from({ length: 24 }, (_, hour) => {
        const major = hour % 6 === 0;
        const lit = hour * 15 >= from && hour * 15 <= to;
        return <Tick key={hour} r0={major ? 33 : 34} r1={major ? 37 : 36} angle={hour * 15} width={major ? 1.5 : 1.1} kind={lit ? "val" : "ink"} />;
      })}
      <path d={arcPath(CX, CY, r, from, to)} pathLength={1} strokeWidth={compact ? 13 : 9} {...mark("val", "s", "draw", DRAW)} />
      {children}
    </>
  );
}

function EarlyStart({ compact }: { readonly compact: boolean }) {
  const r = compact ? 11 : 7.5;
  const horizon = compact ? 15 : 13;
  const y = CY + (compact ? 6 : 4);
  return (
    <Dial compact={compact} from={75} to={105}>
      <g {...mark("cue", "f", "rise", DRAW + 380)}>
        <path d={`M${CX - r} ${y}A${r} ${r} 0 0 1 ${CX + r} ${y}Z`} />
        {compact ? null : [-52, 0, 52].map((angle) => {
          const [x1, y1] = polar(CX, y, r + 3, angle);
          const [x2, y2] = polar(CX, y, r + 6, angle);
          return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.7} className="omo1-cue omo1-s" />;
        })}
      </g>
      <line x1={CX - horizon} y1={y} x2={CX + horizon} y2={y} strokeWidth={compact ? 3.5 : 1.8} {...mark("ink", "s")} />
    </Dial>
  );
}

function NightOwl({ compact }: { readonly compact: boolean }) {
  const r = compact ? 13 : 10;
  return (
    <Dial compact={compact} from={30} to={75}>
      <g {...mark("cue", "f", "rise", DRAW + 380)}>
        <path d={crescentPath(CX - 1, CY + 1, r, r * 0.55, -r * 0.42, r * 0.84)} />
        {compact ? null : (
          <>
            <circle cx={CX + 9} cy={CY - 7} r={1.2} />
            <circle cx={CX + 12.5} cy={CY + 1.5} r={0.9} />
          </>
        )}
      </g>
    </Dial>
  );
}

function WeekendShift({ compact }: { readonly compact: boolean }) {
  const w = compact ? 10 : 7.5;
  const gap = compact ? 3 : 4;
  const x0 = CX - (7 * w + 6 * gap) / 2;
  const base = compact ? 80 : 77;
  const tall = compact ? 50 : 40;
  const low = compact ? 11 : 9;
  return (
    <>
      {compact ? null : <line x1={x0 - 3} y1={base - 30} x2={120 - x0 + 3} y2={base - 30} strokeWidth={1} strokeDasharray="2 2.4" {...mark("ink", "s")} />}
      {Array.from({ length: 7 }, (_, day) => {
        const weekend = day >= 5;
        const h = weekend ? tall : low;
        return <rect key={day} x={x0 + day * (w + gap)} y={base - h} width={w} height={h} rx={compact ? 2.5 : 2} {...mark(weekend ? "val" : "ink", "f", "grow", DRAW + (weekend ? 300 + (day - 5) * 160 : day * 50))} />;
      })}
    </>
  );
}

function Streak7({ compact }: { readonly compact: boolean }) {
  const step = compact ? 14 : 12.4;
  const r = compact ? 6.2 : 4.8;
  const first = CX - 3 * step;
  return (
    <>
      {compact ? null : [CY - 16, CY + 16].map((y) => Array.from({ length: 7 }, (_, day) => <circle key={y + "-" + day} cx={first + day * step} cy={y} r={2.1} {...mark("trk", "f")} />))}
      <line x1={first} y1={CY} x2={CX + 3 * step} y2={CY} strokeWidth={compact ? 3 : 2} {...mark("val", "s", "growx", DRAW)} />
      {Array.from({ length: 7 }, (_, day) => <circle key={day} cx={first + day * step} cy={CY} r={r} {...mark("val", "f", "pop", DRAW + day * 90)} />)}
    </>
  );
}

function Grid({ columns, rows, cell, gap, radius, step }: { readonly columns: number; readonly rows: number; readonly cell: number; readonly gap: number; readonly radius: number; readonly step: (column: number, row: number) => number }) {
  const x0 = CX - (columns * cell + (columns - 1) * gap) / 2;
  const y0 = CY - (rows * cell + (rows - 1) * gap) / 2;
  return (
    <>
      {Array.from({ length: columns * rows }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return <rect key={index} x={x0 + column * (cell + gap)} y={y0 + row * (cell + gap)} width={cell} height={cell} rx={radius} {...mark("val", "f", "pop", DRAW + step(column, row))} />;
      })}
    </>
  );
}

function Streak30({ compact }: { readonly compact: boolean }) {
  return <Grid columns={6} rows={5} cell={compact ? 12 : 8.8} gap={compact ? 3.4 : 2.4} radius={compact ? 2.6 : 2} step={(column, row) => (row * 6 + column) * 24} />;
}

function Focus100h({ compact }: { readonly compact: boolean }) {
  if (compact) return <rect x={CX - 34} y={CY - 34} width={68} height={68} rx={9} {...mark("val", "f", "pop", DRAW)} />;
  return <Grid columns={10} rows={10} cell={5.3} gap={1.2} radius={1.2} step={(column, row) => (column + row) * 36} />;
}

function DayColumn({ compact, uid, children }: { readonly compact: boolean; readonly uid: string; readonly children: (column: { x: number; y: number; w: number; h: number }) => ReactNode }) {
  const column = compact ? { x: 41, y: 15, w: 38, h: 76 } : { x: 43, y: 19, w: 34, h: 68 };
  const clip = uid + "-col";
  return (
    <>
      {compact ? null : [0.25, 0.5, 0.75].map((share) => (
        <line key={share} x1={share === 0.5 ? 35.5 : 37} y1={column.y + column.h * share} x2={40} y2={column.y + column.h * share} strokeWidth={1.2} {...mark("ink", "s")} />
      ))}
      <clipPath id={clip}><rect x={column.x} y={column.y} width={column.w} height={column.h} rx={compact ? 7 : 5} /></clipPath>
      <rect x={column.x} y={column.y} width={column.w} height={column.h} rx={compact ? 7 : 5} {...mark("trk", "f")} />
      <g clipPath={`url(#${clip})`}>{children(column)}</g>
    </>
  );
}

function DriftDay({ compact, uid }: { readonly compact: boolean; readonly uid: string }) {
  const sliver = compact ? 4 : 2.2;
  return (
    <>
      <DayColumn compact={compact} uid={uid}>
        {({ x, y, w, h }) => (
          <>
            <rect x={x} y={y + h * 0.17} width={w} height={h * 0.83 - sliver} {...mark("val", "f", "grow", DRAW + 140, "drift")} />
            <rect x={x} y={y + h - sliver} width={w} height={sliver} {...mark("val", "f", "grow", DRAW, "focus")} />
          </>
        )}
      </DayColumn>
      {compact ? null : (
        <>
          <line x1={79.5} y1={85.9} x2={86} y2={85.9} strokeWidth={1} {...mark("ink", "s")} />
          <circle cx={89.5} cy={85.9} r={2.3} {...mark("val", "f", "pop", DRAW + 760, "focus")} />
        </>
      )}
    </>
  );
}

function NoDriftDay({ compact, uid }: { readonly compact: boolean; readonly uid: string }) {
  const zero = compact ? { cx: 93, cy: 24, rx: 5, ry: 7, w: 3.6 } : { cx: 90, cy: 32.6, rx: 2.3, ry: 3.9, w: 1.6 };
  return (
    <>
      <DayColumn compact={compact} uid={uid}>
        {({ x, y, w, h }) => <rect x={x} y={y + h * 0.2} width={w} height={h * 0.8} {...mark("val", "f", "grow", DRAW, "focus")} />}
      </DayColumn>
      {compact ? null : <line x1={79.5} y1={zero.cy} x2={85} y2={zero.cy} strokeWidth={1} {...mark("ink", "s")} />}
      <ellipse cx={zero.cx} cy={zero.cy} rx={zero.rx} ry={zero.ry} strokeWidth={zero.w} {...mark("val", "s", "pop", DRAW + 760, "drift")} />
    </>
  );
}

function Comeback({ compact }: { readonly compact: boolean }) {
  const w = compact ? 14 : 12;
  const gap = compact ? 5 : 6;
  const x0 = CX - (4 * w + 3 * gap) / 2;
  const base = compact ? 82 : 79;
  const heights = compact ? [11, 9, 12, 56] : [9, 7, 10, 48];
  const peak = x0 + 3 * (w + gap) + w / 2;
  return (
    <>
      {compact ? null : <line x1={x0 - 3} y1={base - 38} x2={120 - x0 + 3} y2={base - 38} strokeWidth={1} strokeDasharray="2 2.4" {...mark("ink", "s")} />}
      {heights.map((h, day) => (
        <rect key={day} x={x0 + day * (w + gap)} y={base - h} width={w} height={h} rx={compact ? 3 : 2.4} {...mark(day === 3 ? "val" : "ink", "f", "grow", DRAW + (day === 3 ? 360 : day * 70))} />
      ))}
      {compact ? null : (
        <path d={`M${peak - 4.5} ${base - 53}L${peak} ${base - 57.5}L${peak + 4.5} ${base - 53}`} strokeWidth={2} {...mark("cue", "s", "rise", DRAW + 820)} />
      )}
    </>
  );
}

function Chart({ id, compact, uid }: { readonly id: AchievementId; readonly compact: boolean; readonly uid: string }) {
  switch (id) {
    case "firstFlow": return <FirstFlow compact={compact} />;
    case "flow90": return <Flow90 compact={compact} />;
    case "flow180": return <Flow180 compact={compact} />;
    case "focusDay8h": return <FocusDay compact={compact} />;
    case "earlyStart": return <EarlyStart compact={compact} />;
    case "nightOwl": return <NightOwl compact={compact} />;
    case "weekendShift": return <WeekendShift compact={compact} />;
    case "streak7": return <Streak7 compact={compact} />;
    case "streak30": return <Streak30 compact={compact} />;
    case "focus100h": return <Focus100h compact={compact} />;
    case "driftDay": return <DriftDay compact={compact} uid={uid} />;
    case "noDriftDay": return <NoDriftDay compact={compact} uid={uid} />;
    case "comeback": return <Comeback compact={compact} />;
  }
}

/** Milestones as six notches on the bottom rim; a one-time achievement shows one whole mark instead. */
function Notches({ once, tier, earned }: { readonly once: boolean; readonly tier: number; readonly earned: boolean }) {
  if (once) {
    return (
      <>
        <rect x={32.5} y={96} width={55} height={3.2} rx={1.6} className="omo1-notch" />
        {earned ? <rect x={32.5} y={96} width={55} height={3.2} rx={1.6} className="omo1-notch-lit" style={{ "--omo1-d": NOTCH } as CSSProperties} /> : null}
      </>
    );
  }
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => {
        const x = 32.5 + index * 9.6;
        return (
          <g key={index}>
            <rect x={x} y={96} width={7} height={3.2} rx={1.6} className="omo1-notch" />
            {index < tier ? <rect x={x} y={96} width={7} height={3.2} rx={1.6} className="omo1-notch-lit" style={{ "--omo1-d": NOTCH + index * NOTCH_STEP } as CSSProperties} /> : null}
          </g>
        );
      })}
    </>
  );
}

export function AchievementOmo1({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = "omo1" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const compact = !detail;
  const plate = compact ? PLATE_COMPACT : PLATE;
  const once = ONE_TIME.has(id);
  const earned = state === "earned";
  const shownTier = earned && !once ? Math.max(0, Math.min(6, tier)) : 0;
  const chart = <Chart id={id} compact={compact} uid={uid} />;
  return (
    <svg
      className="omo1"
      viewBox="0 0 120 120"
      data-id={id}
      data-group={group}
      data-state={state}
      data-tier={shownTier}
      data-detail={detail ? "true" : "false"}
      data-entrance={entrance && earned ? "true" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {state === "concealed" ? (
        <defs>
          <pattern id={uid + "-dots"} patternUnits="userSpaceOnUse" width={compact ? 16 : 7} height={compact ? 16 : 7}>
            <circle cx={compact ? 8 : 3.5} cy={compact ? 8 : 3.5} r={compact ? 3.4 : 0.85} className="omo1-dot" />
          </pattern>
        </defs>
      ) : null}
      {compact ? null : <path d={plate} transform="translate(0 1.6)" className="omo1-shadow" />}
      <path d={plate} className="omo1-plate" />
      {earned ? <path d={plate} className="omo1-tint" /> : null}
      {state === "concealed" ? <path d={plate} fill={`url(#${uid}-dots)`} className="omo1-dots" /> : null}
      <path d={plate} className="omo1-edge" />
      {shownTier >= 6 ? <path d={plate} className="omo1-rim" /> : null}
      {state === "concealed" ? null : compact ? <g transform={`translate(60 60) scale(1.12) translate(-60 -${CY})`}>{chart}</g> : chart}
      {state === "concealed" || compact ? null : <Notches once={once} tier={shownTier} earned={earned} />}
    </svg>
  );
}
