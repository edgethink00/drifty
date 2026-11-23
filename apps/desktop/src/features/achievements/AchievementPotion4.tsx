import { useId, type ReactNode } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import "./achievementPotion4.css";

/*
 * Direction 4, "한 방울": focus distils into one drop. A slim glass pipette
 * lets a single glossy drop go; the achievement's symbol is seen through the
 * liquid. Below, a shallow glass dish keeps one ripple ring per milestone.
 * Everything is drawn in a 100 x 100 box; colours live in the stylesheet.
 */

/** The drop: a sharp top just under the pipette tip, a round belly centred at (50, 63). */
const DROP = "M50 38 C52.8 44.2 67.5 49.5 67.5 62.5 A17.5 17.5 0 0 1 32.5 62.5 C32.5 49.5 47.2 44.2 50 38 Z";
const DROP_TOP_Y = 38;
const SYMBOL_ORIGIN = "translate(50 64)";

/** Ripple radii across the dish, innermost first; one per milestone. */
const RING_RX = [8.5, 14.5, 20.5, 26.5, 32.5, 38] as const;
/** Non-repeatable achievements arrive complete: a full splash set. */
const SPLASH_RX = [9, 18, 27, 36.5] as const;
const RING_SQUASH = 0.2;
const DISH_CY = 86.5;

/** Thirty dashes around a ring of radius 7.5. */
const MONTH_DASH = `${((2 * Math.PI * 7.5) / 30) * 0.62} ${((2 * Math.PI * 7.5) / 30) * 0.38}`;

const WEEK_BEADS = [[0, 0], ...Array.from({ length: 6 }, (_, i) => {
  const angle = (i * Math.PI) / 3 - Math.PI / 2;
  return [Math.cos(angle) * 6.4, Math.sin(angle) * 6.4];
})] as const;

const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * One symbol per achievement, drawn about the origin within roughly ±9.
 * Line marks use the ink stroke, solid marks the ink fill, and "cut" lines are
 * drawn in the liquid colour to carve into a solid mark.
 */
const SYMBOLS: Record<AchievementId, ReactNode> = {
  // First flow: a first leaf.
  firstFlow: (
    <>
      <path className="p4-sym-fill" d="M-6.5 7.5 C-9.5 -1.5 -2.5 -8.5 8.5 -8.5 C8.5 2.5 2.5 8.5 -6.5 7.5 Z" />
      <path className="p4-sym-cut" d="M-5.5 6.5 C-1.5 2 1.5 -1 5 -4.5" />
    </>
  ),
  // Ninety minutes: a quarter of the clock, filled.
  flow90: (
    <>
      <circle className="p4-sym-faint" r="8" />
      <path className="p4-sym-fill" d="M0 1 L0 -8.6 A8.6 8.6 0 0 1 8.6 1 Z" transform="translate(-0.6 -0.4)" />
    </>
  ),
  // Three hours: half of the clock, filled; twice the ninety minutes.
  flow180: (
    <>
      <circle className="p4-sym-faint" r="8" />
      <path className="p4-sym-fill" d="M0 -8.6 A8.6 8.6 0 0 1 0 8.6 Z" transform="translate(0.4 0)" />
    </>
  ),
  // A whole focused day: the sun, eight rays.
  focusDay8h: (
    <>
      <circle className="p4-sym-fill" r="4.2" />
      {SUN_RAYS.map(([x, y], i) => (
        <path key={i} className="p4-sym-line p4-sym-line--thin" d={`M${x * 6.6} ${y * 6.6} L${x * 9} ${y * 9}`} />
      ))}
    </>
  ),
  // Early start: the sun coming over the horizon.
  earlyStart: (
    <>
      <path className="p4-sym-fill" d="M-5.6 4 A5.6 5.6 0 0 1 5.6 4 Z" />
      <path className="p4-sym-line" d="M-9 4 L9 4" />
      <path className="p4-sym-line p4-sym-line--thin" d="M0 -3.4 L0 -6.4 M5.2 -1.2 L7.3 -3.3 M-5.2 -1.2 L-7.3 -3.3" />
      <path className="p4-sym-faint" d="M-5 8 L5 8" />
    </>
  ),
  // Night owl: a crescent moon and one star.
  nightOwl: (
    <>
      <path className="p4-sym-fill" d="M2.5 -8.1 A8.4 8.4 0 1 0 8.6 3 A6.6 6.6 0 0 1 2.5 -8.1 Z" />
      <circle className="p4-sym-fill" cx="6.6" cy="-6.2" r="1.5" />
    </>
  ),
  // Weekend shift: a week's page with its last two days filled in.
  weekendShift: (
    <>
      <rect className="p4-sym-line p4-sym-line--thin" x="-7.4" y="-6.2" width="15.6" height="14" rx="2.4" />
      <path className="p4-sym-fill" d="M-7.4 -3.8 A2.4 2.4 0 0 1 -5 -6.2 L5.8 -6.2 A2.4 2.4 0 0 1 8.2 -3.8 L8.2 -2.4 L-7.4 -2.4 Z" />
      <rect className="p4-sym-fill" x="1.2" y="0" width="4.8" height="5.4" rx="1.1" />
      <circle className="p4-sym-fill p4-sym-fill--soft" cx="-3.6" cy="1.2" r="1.05" />
      <circle className="p4-sym-fill p4-sym-fill--soft" cx="-3.6" cy="4.4" r="1.05" />
    </>
  ),
  // Seven days: seven beads.
  streak7: (
    <>
      {WEEK_BEADS.map(([x, y], i) => <circle key={i} className="p4-sym-fill" cx={x} cy={y} r="2.05" />)}
    </>
  ),
  // Thirty days: a ring of thirty segments.
  streak30: (
    <>
      <circle className="p4-sym-line p4-sym-line--ring" r="7.5" strokeDasharray={MONTH_DASH} transform="rotate(-90)" />
      <circle className="p4-sym-fill" r="2" />
    </>
  ),
  // A hundred hours: one hundred, drawn.
  focus100h: (
    <>
      <path className="p4-sym-line p4-sym-line--thin" d="M-10.2 -4.4 L-8 -6.6 L-8 6.6" />
      <ellipse className="p4-sym-line p4-sym-line--thin" cx="-1.4" rx="2.9" ry="6.4" />
      <ellipse className="p4-sym-line p4-sym-line--thin" cx="6.6" rx="2.9" ry="6.4" />
    </>
  ),
  // A day of drifting: the liquid spills into waves.
  driftDay: (
    <>
      <path className="p4-sym-line" d="M-9 -3 C-6.5 -6.6 -3.5 -6.6 -1.5 -3 S3.5 0.6 6 -3 S8.4 -5 9.4 -4.4" />
      <path className="p4-sym-line" d="M-9 4.2 C-6.5 0.6 -3.5 0.6 -1.5 4.2 S3.5 7.8 6 4.2 S8.4 2.2 9.4 2.8" />
    </>
  ),
  // No drift at all: a beam resting perfectly level on its point.
  noDriftDay: (
    <>
      <path className="p4-sym-line" d="M-9.4 -0.6 L9.4 -0.6" />
      <path className="p4-sym-fill" d="M0 0.4 L4.4 7.6 L-4.4 7.6 Z" />
      <circle className="p4-sym-fill" cx="0" cy="-5" r="2.2" />
    </>
  ),
  // Comeback: the line turns and comes back.
  comeback: (
    <>
      <path className="p4-sym-line" d="M7.5 -5.5 L-2 -5.5 A5.6 5.6 0 0 0 -2 5.7 L5.5 5.7" />
      <path className="p4-sym-line" d="M2.4 2.4 L5.7 5.7 L2.4 9" />
    </>
  ),
};

const CONCEALED_SYMBOL = (
  <>
    <path className="p4-sym-line" d="M-4.2 -3.6 C-4.2 -9 4.4 -9 4.4 -3.6 C4.4 -0.6 0 -0.4 0 3.2" />
    <circle className="p4-sym-fill" cx="0" cy="7.6" r="1.7" />
  </>
);

const CLOUDS = [[43, 55, 7.5], [57, 59, 8.5], [46, 71, 8], [59, 73, 6], [38, 65, 5.5]] as const;

/** Little drops thrown up by the splash; x, y, radius. */
const SPLASH_BEADS = [[30.5, 81, 1.2], [37, 78.2, 1.55], [63, 78.2, 1.55], [69.5, 81, 1.2]] as const;

function domId(raw: string): string {
  return "p4" + raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** The drop, its gloss and the symbol inside it. Shared by every size. */
function Drop({ uid, state, symbol }: { readonly uid: string; readonly state: AchievementArtProps["state"]; readonly symbol: ReactNode }) {
  if (state === "locked") {
    return (
      <g className="p4-drop">
        <path className="p4-drop__outline" d={DROP} />
        <g className="p4-sym p4-sym--faint" transform={SYMBOL_ORIGIN}>{symbol}</g>
      </g>
    );
  }
  return (
    <g className="p4-drop">
      <path className="p4-drop__body" d={DROP} fill={`url(#${uid}-body)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        {state === "concealed"
          ? CLOUDS.map(([cx, cy, r], i) => <circle key={i} className="p4-cloud" cx={cx} cy={cy} r={r} />)
          : <path className="p4-drop__caustic" d="M36 69 A14.8 14.8 0 0 0 64 69 A16 11 0 0 1 36 69 Z" />}
        <g className="p4-sym" transform={SYMBOL_ORIGIN + " scale(1.12 1.08)"}>{symbol}</g>
      </g>
      <path className="p4-drop__rim" d={DROP} />
      <ellipse className="p4-drop__gloss" cx="40.6" cy="53.4" rx="2.9" ry="5.8" transform="rotate(28 40.6 53.4)" />
      <circle className="p4-drop__glint" cx="45.2" cy="46" r="1" />
    </g>
  );
}

/** Ripple rings on the dish: one per milestone, or the full splash set for one-time achievements. */
function Ripples({ tier, entrance }: { readonly tier: number; readonly entrance: boolean }) {
  const complete = tier === 0;
  const radii = complete ? SPLASH_RX : RING_RX.slice(0, Math.min(tier, RING_RX.length));
  const goldIndex = complete ? radii.length - 1 : tier >= RING_RX.length ? RING_RX.length - 1 : -1;
  return (
    <g className="p4-ripples">
      {radii.map((rx, i) => (
        <ellipse
          key={rx}
          className={"p4-ring" + (i === goldIndex ? " p4-ring--gold" : "")}
          cx="50"
          cy={DISH_CY}
          rx={rx}
          ry={rx * RING_SQUASH}
          style={entrance ? { animationDelay: 1080 + i * 90 + "ms" } : undefined}
        />
      ))}
      {complete
        ? SPLASH_BEADS.map(([cx, cy, r], i) => (
          <circle key={i} className="p4-bead" cx={cx} cy={cy} r={r} style={entrance ? { animationDelay: 1040 + "ms" } : undefined} />
        ))
        : null}
    </g>
  );
}

export function AchievementPotion4({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = domId(useId());
  const earned = state === "earned";
  const symbol = state === "concealed" ? CONCEALED_SYMBOL : SYMBOLS[id];
  const showGroup = state === "concealed" ? undefined : group;
  const animate = entrance && earned && detail;
  const className = "potion4" + (detail ? "" : " potion4--compact") + (animate ? " is-entrance" : "");

  const defs = (
    <defs>
      <radialGradient id={`${uid}-body`} cx="0.5" cy="0.74" r="0.78" fx="0.52" fy="0.8">
        <stop className="p4-stop-light" offset="0" />
        <stop className="p4-stop-mid" offset="0.52" />
        <stop className="p4-stop-deep" offset="1" />
      </radialGradient>
      <clipPath id={`${uid}-clip`}>
        <path d={DROP} />
      </clipPath>
      <radialGradient id={`${uid}-halo`}>
        <stop className="p4-halo-in" offset="0" />
        <stop className="p4-halo-out" offset="1" />
      </radialGradient>
      <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="0">
        <stop className="p4-glass-edge" offset="0" />
        <stop className="p4-glass-mid" offset="0.45" />
        <stop className="p4-glass-edge" offset="1" />
      </linearGradient>
      <clipPath id={`${uid}-barrel`}>
        <path d="M46.9 18.6 L53.1 18.6 L53.1 28.4 L51 34 L49 34 L46.9 28.4 Z" />
      </clipPath>
      <clipPath id={`${uid}-pool`}>
        <ellipse cx="50" cy={DISH_CY} rx="39.5" ry="7.9" />
      </clipPath>
    </defs>
  );

  if (!detail) {
    return (
      <svg className={className} viewBox="0 0 100 100" data-group={showGroup} data-state={state} aria-hidden="true" focusable="false">
        {defs}
        <g transform={`translate(50 5) scale(2.07) translate(-50 ${-DROP_TOP_Y})`}>
          <Drop uid={uid} state={state} symbol={symbol} />
        </g>
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 100 100" data-group={showGroup} data-state={state} aria-hidden="true" focusable="false">
      {defs}

      {/* Dish: a shallow watch glass; earned, it holds a thin pool of the same liquid. */}
      <g className="p4-dish">
        <path className="p4-dish__body" d="M7 86 C8.5 92.8 29 96 50 96 C71 96 91.5 92.8 93 86 Z" />
        <ellipse className="p4-dish__top" cx="50" cy="86" rx="43" ry="9.4" />
        {state === "locked" ? null : <ellipse className="p4-pool" cx="50" cy={DISH_CY} rx="39.5" ry="7.9" />}
        {earned ? (
          <g clipPath={`url(#${uid}-pool)`}>
            <ellipse className="p4-shadow" cx="50" cy={DISH_CY + 0.4} rx="12.5" ry="2.8" />
            <ellipse className="p4-caustic" cx="50" cy={DISH_CY} rx="4.6" ry="1.1" />
          </g>
        ) : null}
        {earned ? <Ripples tier={tier} entrance={animate} /> : null}
        <path className="p4-dish__lip" d="M10.5 90 C21 94 37 95.1 50 95.1 C63 95.1 79 94 89.5 90" />
      </g>

      {earned ? <circle className="p4-halo" cx="50" cy="62" r="29" fill={`url(#${uid}-halo)`} /> : null}

      {/* Pipette: rubber bulb, collar (gold from the fourth milestone), tapering glass barrel. */}
      <g className="p4-pipette">
        <path className="p4-bulb" d="M45 16 L45 10.6 C45 4.6 55 4.6 55 10.6 L55 16 Z" />
        <path className="p4-bulb__shine" d="M47 14 L47 10.6 C47 8.6 48 7.4 49.4 7" />
        <path className="p4-barrel" d="M46.9 18.6 L53.1 18.6 L53.1 28.4 L51 34 L49 34 L46.9 28.4 Z" fill={`url(#${uid}-glass)`} />
        {state === "locked" ? null : (
          <g clipPath={`url(#${uid}-barrel)`}>
            <rect className="p4-barrel__liquid" x="46" y="26.6" width="8" height="9" />
          </g>
        )}
        <path className="p4-barrel__edge" d="M46.9 18.6 L53.1 18.6 L53.1 28.4 L51 34 L49 34 L46.9 28.4 Z" />
        <path className="p4-barrel__shine" d="M48.1 20.2 L48.1 27.6" />
        <rect className={"p4-collar" + (earned && tier >= 4 ? " p4-collar--gold" : "")} x="43.8" y="15.4" width="12.4" height="3.3" rx="1.2" />
        {state === "locked" ? null : <circle className="p4-tip-bead" cx="50" cy="35.1" r="1.1" />}
      </g>

      <Drop uid={uid} state={state} symbol={symbol} />
    </svg>
  );
}
