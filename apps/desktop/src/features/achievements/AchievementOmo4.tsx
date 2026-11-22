import { useId, type CSSProperties, type ReactNode } from "react";
import type { AchievementGroup, AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import { CX, CY, framePath, polar, starPath, twinklePath } from "./achievementOmo4Shapes";
import "./achievementOmo4.css";

/** How far each stamp was turned when it was pressed by hand; the level-day stamp went down dead straight. */
const PRESS_TURN: Readonly<Record<AchievementId, number>> = {
  firstFlow: -6, flow90: 4, flow180: -3, focusDay8h: 7, earlyStart: -5, nightOwl: 5, weekendShift: -7,
  streak7: 3, streak30: -4, focus100h: 6, driftDay: -8, noDriftDay: 0, comeback: 5,
};

const SEED: Readonly<Record<AchievementId, number>> = {
  firstFlow: 3, flow90: 7, flow180: 11, focusDay8h: 17, earlyStart: 23, nightOwl: 29, weekendShift: 31,
  streak7: 37, streak30: 41, focus100h: 43, driftDay: 47, noDriftDay: 53, comeback: 59,
};

/** Earlier impressions behind the latest one, newest first: offset x, y, turn and ink strength. */
const GHOSTS: readonly (readonly [number, number, number, number])[] = [
  [-11, -8, -13, 0.58], [12, -6, 11, 0.47], [-9, 11, 16, 0.38], [11, 10, -10, 0.3], [1, -13, 6, 0.24],
];

type Tone = { readonly cut: string; readonly keep: string };

/** The pictogram carved out of the stamp: `cut` is what the carver removed, `keep` the ink left standing inside a cut. */
function Pictogram({ id, bold, cut, keep }: { readonly id: AchievementId; readonly bold: boolean } & Tone): ReactNode {
  const w = bold ? 7.4 : 5;
  const line = { fill: "none", stroke: cut, strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (id) {
    case "firstFlow":
      return (
        <>
          <path fill={cut} d="M60 33C63 42 73 48 75 60C77 72 69 82 60 82C51 82 43 74 44 63C45 55 50 51 52 45C55 50 56 53 58 54C58 47 58 40 60 33Z" />
          {bold ? null : <path fill={keep} d="M60 59C63 64 66.5 67 66.5 71.5C66.5 75.5 63.8 78 60 78C56.2 78 53.5 75.5 53.5 71.5C53.5 67 57 64 60 59Z" />}
        </>
      );
    case "flow90":
      return (
        <>
          <circle {...line} cx="60" cy="62" r={bold ? 18 : 17} />
          <rect fill={cut} x="55" y="35" width="10" height="5.5" rx="1.6" />
          <path {...line} strokeWidth={w * 0.85} d="M60 40V45" />
          {bold ? null : <path {...line} strokeWidth={w * 0.8} d="M73 46.5L76.5 43" />}
          <path fill={cut} d={bold ? "M60 62V52A10 10 0 0 1 70 62Z" : "M60 62V50A12 12 0 0 1 72 62Z"} />
        </>
      );
    case "flow180":
      return (
        <>
          <path fill={cut} strokeLinejoin="round" stroke={cut} strokeWidth="2" d="M32 80L53 43L62 57L69.5 47L88 80Z" />
          {bold ? null : <path fill={keep} d="M53 43L58.9 53.4L55.6 51.6L53 55L50.3 51.6L47.1 53.4Z" />}
        </>
      );
    case "focusDay8h":
      return (
        <>
          <circle fill={cut} cx="60" cy="58" r={bold ? 11 : 10} />
          {Array.from({ length: 8 }, (_, k) => {
            const [x1, y1] = polar(60, 58, bold ? 17 : 15.5, k * 45 - 90);
            const [x2, y2] = polar(60, 58, bold ? 24.5 : 23.5, k * 45 - 90);
            return <path key={k} {...line} d={`M${x1} ${y1}L${x2} ${y2}`} />;
          })}
        </>
      );
    case "earlyStart":
      return (
        <>
          <path fill={cut} d="M45 67A15 15 0 0 1 75 67Z" />
          {[-90, -140, -40, ...(bold ? [] : [-168, -12])].map((angle) => {
            const [x1, y1] = polar(60, 67, 20, angle);
            const [x2, y2] = polar(60, 67, 26, angle);
            return <path key={angle} {...line} d={`M${x1} ${y1}L${x2} ${y2}`} />;
          })}
          <path {...line} d="M33 73H87" />
          {bold ? null : <path {...line} d="M45 81.5H75" />}
        </>
      );
    case "nightOwl":
      return (
        <>
          <circle fill={cut} cx="55" cy="61" r={bold ? 21 : 19.5} />
          <circle fill={keep} cx={bold ? 63 : 62.5} cy={bold ? 54 : 54} r={bold ? 17 : 16} />
          <path fill={cut} d={twinklePath(79, 42, bold ? 9 : 7.5)} />
          {bold ? null : <path fill={cut} d={twinklePath(81, 64, 5)} />}
        </>
      );
    case "weekendShift":
      return (
        <>
          {[34.5, 61.5].map((x) => (
            <g key={x}>
              <rect {...line} strokeWidth={w * 0.9} x={x} y="46" width="24" height="26" rx="3.5" />
              <rect fill={cut} x={x} y="46" width="24" height="7.5" rx="3" />
              <path {...line} strokeWidth={w * 0.8} d={`M${x + 6.5} 41V47M${x + 17.5} 41V47`} />
              <path {...line} strokeWidth={w * (bold ? 0.8 : 0.75)} d={`M${x + 6.5} 63L${x + 10.5} 67L${x + 17.5} 58.5`} />
            </g>
          ))}
        </>
      );
    case "streak7":
      return (
        <>
          <path {...line} d={bold ? "M37 44V72M47 44V72M57 44V72M67 44V72M80 44V72" : "M36 44V72M44 44V72M52 44V72M60 44V72M74 44V72M82 44V72"} />
          <path {...line} d={bold ? "M32 66L72 50" : "M31 66L65 50"} />
        </>
      );
    case "streak30":
      return bold ? (
        <>
          {Array.from({ length: 12 }, (_, k) => <circle key={k} fill={cut} cx={42 + (k % 4) * 12} cy={46 + Math.floor(k / 4) * 12} r="4.4" />)}
        </>
      ) : (
        <>
          {Array.from({ length: 30 }, (_, k) => <circle key={k} fill={cut} cx={39 + (k % 6) * 8.4} cy={41.5 + Math.floor(k / 6) * 8.4} r="2.7" />)}
        </>
      );
    case "focus100h": {
      const leaves = bold ? [128, 166, 204] : [124, 150, 176, 202, 228];
      const branch = (
        <>
          <path {...line} strokeWidth={w * 0.6} d={`M${polar(60, 58, 22, 98).join(" ")}A22 22 0 0 1 ${polar(60, 58, 22, 236).join(" ")}`} />
          {leaves.map((angle) => {
                        const [ox, oy] = polar(60, 58, bold ? 26 : 25.5, angle - 8);
            const [ix, iy] = polar(60, 58, bold ? 18 : 18.5, angle - 8);
            return (
              <g key={angle}>
                <ellipse fill={cut} cx={ox} cy={oy} rx={bold ? 3.6 : 2.7} ry={bold ? 6.8 : 5.6} transform={`rotate(${angle - 35} ${ox} ${oy})`} />
                {bold ? null : <ellipse fill={cut} cx={ix} cy={iy} rx="2.4" ry="5" transform={`rotate(${angle + 15} ${ix} ${iy})`} />}
              </g>
            );
          })}
        </>
      );
      return (
        <>
          <g>{branch}</g>
          <g transform="translate(120 0) scale(-1 1)">{branch}</g>
          <path fill={cut} d={starPath(60, 57, bold ? 8.5 : 7.5)} />
        </>
      );
    }
    case "driftDay":
      return (
        <>
          <g transform="rotate(-9 60 62)">
            <path fill={cut} strokeLinejoin="round" stroke={cut} strokeWidth="2" d="M40 63H80L72.5 72H47.5Z" />
            <path fill={cut} strokeLinejoin="round" stroke={cut} strokeWidth="2" d="M60 37V59H44Z" />
            {bold ? null : <path fill={cut} strokeLinejoin="round" stroke={cut} strokeWidth="2" d="M64 43V59H75Z" />}
          </g>
          <path {...line} d="M33 81Q39.75 76 46.5 81T60 81T73.5 81T87 81" />
        </>
      );
    case "noDriftDay":
      return (
        <>
          <rect {...line} x="32" y="48" width="56" height="19" rx="9.5" />
          <circle fill={cut} cx="60" cy="57.5" r={bold ? 5 : 4.6} />
          {bold ? null : <path {...line} strokeWidth={w * 0.6} d="M51 53V62M69 53V62" />}
          <path {...line} d="M36 77H84" />
        </>
      );
    case "comeback":
      return (
        <>
          <path {...line} d="M33 45C43 45 47 74 59 74C70 74 74 55 81.2 46.8" />
          <path fill={cut} strokeLinejoin="round" stroke={cut} strokeWidth="2" d="M89.5 38.5L86.4 52.4L75.6 41.6Z" />
        </>
      );
  }
}

const TICK_REACH: Readonly<Record<AchievementGroup, number>> = { focus: 32.5, rhythm: 31, consistency: 29.5, unexpected: 29.5 };

function Ticks({ tier, group, cut }: { readonly tier: number; readonly group: AchievementGroup; readonly cut: string }) {
  const reach = TICK_REACH[group];
  return (
    <path
      fill="none"
      stroke={cut}
      strokeWidth="2.3"
      strokeLinecap="round"
      d={Array.from({ length: tier }, (_, k) => {
        const angle = 58 + k * 9.5;
        const [x1, y1] = polar(CX, CY, reach, angle);
        const [x2, y2] = polar(CX, CY, reach + 4.5, angle);
        return `M${x1} ${y1}L${x2} ${y2}`;
      }).join("")}
    />
  );
}

function sanitize(id: string): string {
  return "omo4" + id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** omo 4, 출석 도장: each badge is the impression a carved seal leaves on paper. */
export function AchievementOmo4({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = sanitize(useId());
  const turn = PRESS_TURN[id];
  const outline = framePath(group);
  const scale = detail ? 0.92 : 1.12;
  const fit = `translate(${CX} ${CY - 2}) scale(${scale}) translate(${-CX} ${-CY + 2})`;
  const root = {
    className: "omo4",
    viewBox: "0 0 120 120",
    "aria-hidden": true,
    focusable: false,
    "data-id": id,
    "data-group": group,
    "data-state": state,
    "data-tier": tier,
    "data-detail": detail,
    "data-entrance": entrance && state === "earned",
  } as const;

  if (state !== "earned") {
    const concealed = state === "concealed";
    return (
      <svg {...root}>
        {concealed ? null : (
          <defs>
            <mask id={uid + "p"} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
              <g transform={fit}><Pictogram id={id} bold={!detail} cut="white" keep="black" /></g>
            </mask>
          </defs>
        )}
        <path className="omo4-dash" d={outline} />
        {detail && !concealed ? <path className="omo4-dash omo4-dash--inner" d={framePath(group, -4.6, true)} /> : null}
        {concealed ? (
          <>
            {detail ? <path className="omo4-fold" d="M80 16H96V32Z" /> : null}
            {detail ? <path className="omo4-fold-flap" d="M80 16V32H96Z" /> : null}
            <path className="omo4-pencil" d="M51.5 50C51.5 43.5 55.5 39.5 61 39.5C66.5 39.5 70 43 70 48C70 53.5 64.5 55 62 57.6C60.8 58.8 60.6 60.4 60.6 63" />
            <circle className="omo4-pencil-dot" cx="60.6" cy="71.5" r={detail ? 2.3 : 4.2} />
          </>
        ) : (
          <>
            {detail ? <rect className="omo4-emboss-shade" x="0" y="0" width="120" height="120" mask={`url(#${uid}p)`} transform="translate(0.7 0.9)" /> : null}
            <rect className="omo4-emboss" x="0" y="0" width="120" height="120" mask={`url(#${uid}p)`} />
          </>
        )}
      </svg>
    );
  }

  const ghosts = detail ? GHOSTS.slice(0, Math.max(0, Math.min(tier, 6) - 1)) : [];
  const crowned = detail && tier >= 6;
  const stamp = (
    <g filter={detail ? `url(#${uid}f)` : undefined}>
      <rect x="0" y="0" width="120" height="120" fill="currentColor" mask={`url(#${uid}m)`} />
    </g>
  );

  return (
    <svg {...root}>
      <defs>
        {detail ? (
          <filter id={uid + "f"} x="0" y="0" width="120" height="120" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves={2} seed={SEED[id]} result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={SEED[id] + 5} result="cloud" />
            <feColorMatrix in="cloud" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.45 0 0 0 0.74" result="density" />
            <feComposite in="rough" in2="density" operator="in" result="inked" />
            <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves={1} seed={SEED[id] + 9} result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  12 0 0 0 -8.5" result="specks" />
            <feComposite in="inked" in2="specks" operator="out" />
          </filter>
        ) : null}
        <mask id={uid + "m"} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <path fill="white" d={outline} />
          {detail ? <path fill="none" stroke="black" strokeWidth="1.8" d={framePath(group, -4.6, true)} /> : null}
          <g transform={fit}><Pictogram id={id} bold={!detail} cut="black" keep="white" /></g>
          {detail && tier > 1 ? <Ticks tier={Math.min(tier, 6)} group={group} cut="black" /> : null}
        </mask>
        {ghosts.length > 0 ? (
          <mask id={uid + "g"} maskUnits="userSpaceOnUse" x="-20" y="-20" width="160" height="160">
            <rect x="-20" y="-20" width="160" height="160" fill="white" />
            <path fill="black" stroke="black" strokeWidth="3" d={outline} transform={`rotate(${turn} ${CX} ${CY})`} />
          </mask>
        ) : null}
      </defs>
      {ghosts.length > 0 ? (
        <g mask={`url(#${uid}g)`}>
          {ghosts.map(([dx, dy, spin, ink], index) => ({ dx, dy, spin, ink, index })).reverse().map(({ dx, dy, spin, ink, index }) => (
            <g key={index} className="omo4-ghost" style={{ "--omo4-i": ghosts.length - 1 - index } as CSSProperties}>
              <g className="omo4-echo" style={{ opacity: `calc(${ink} * var(--omo4-ghost-boost, 1))` }} transform={`translate(${dx} ${dy}) rotate(${turn + spin} ${CX} ${CY})`}>
                <path className="omo4-echo__rim" d={framePath(group, -1.4)} />
              </g>
            </g>
          ))}
        </g>
      ) : null}
      {crowned ? (
        <g className="omo4-crown" style={{ "--omo4-i": ghosts.length } as CSSProperties}>
          <path className="omo4-crown__ring" d={framePath(group, 5.2, true)} transform={`rotate(${turn - 4} ${CX} ${CY})`} filter={`url(#${uid}f)`} />
        </g>
      ) : null}
      <g className="omo4-press">
        <g transform={`rotate(${turn} ${CX} ${CY})`}>
          {entrance ? <path className="omo4-halo" d={outline} /> : null}
          <g className="omo4-ink">{stamp}</g>
        </g>
      </g>
    </svg>
  );
}
