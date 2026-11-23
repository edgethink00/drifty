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
const BARREL = "M47.4 18.2 L52.6 18.2 L52.6 28.6 L50.8 34.3 L49.2 34.3 L47.4 28.6 Z";
const SYMBOL_ORIGIN = "translate(50 64)";

const RING_SQUASH = 0.17;
const DISH_CY = 85.6;

/** Seven arcs of a ring; the week starts lower left so the weekend lands lower right, clear of the highlight. */
const WEEK_RING = Array.from({ length: 7 }, (_, i) => {
  const at = (r: number, deg: number) => `${(r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const a0 = 102.86 + i * (360 / 7) + 5;
  const a1 = a0 + 360 / 7 - 10;
  return `M${at(8.8, a0)} A8.8 8.8 0 0 1 ${at(8.8, a1)} L${at(4.4, a1)} A4.4 4.4 0 0 0 ${at(4.4, a0)} Z`;
});

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
  // Weekend shift: the week as a ring of seven days, Saturday and Sunday filled.
  weekendShift: (
    <>
      {WEEK_RING.map((d, i) => <path key={i} className={"p4-sym-seg" + (i >= 5 ? " p4-sym-seg--bold" : "")} d={d} />)}
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
  // A hundred hours: an hourglass, its lower bulb filled.
  focus100h: (
    <>
      <path className="p4-sym-line p4-sym-line--thin" d="M-6.4 -8 L6.4 -8 M-6.4 8 L6.4 8" />
      <path className="p4-sym-line p4-sym-line--hair" d="M-4.8 -8 C-4.8 -3.4 -1 -1.6 -1 0 C-1 1.6 -4.8 3.4 -4.8 8 M4.8 -8 C4.8 -3.4 1 -1.6 1 0 C1 1.6 4.8 3.4 4.8 8" />
      <path className="p4-sym-fill" d="M-2.6 -4.6 L2.6 -4.6 L0 -1.4 Z M0 1.6 L4.2 7 L-4.2 7 Z" />
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


/** Little drops thrown up by the splash; x, y, radius. */
const SPLASH_BEADS = [[34, 82, 0.9], [38.5, 80, 1.15], [61.5, 80, 1.15], [66, 82, 0.9]] as const;

const SPARKLE = "M0 -4.2 L0.9 -0.9 L4.2 0 L0.9 0.9 L0 4.2 L-0.9 0.9 L-4.2 0 L-0.9 -0.9 Z";
const MOON = "M2.5 -8.1 A8.4 8.4 0 1 0 8.6 3 A6.6 6.6 0 0 1 2.5 -8.1 Z";

/** Focus hangs from the tip; the others have just let go. */
function dropPlacement(group: AchievementArtProps["group"] | undefined): string {
  return `translate(50 ${group === "focus" ? 27.2 : 29.4}) scale(1.12) translate(-50 ${-DROP_TOP_Y})`;
}

/** Unexpected drops wobble; their symbol stays upright. */
const TILT = 19;

function domId(raw: string): string {
  return "p4" + raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

type DropProps = {
  readonly uid: string;
  readonly state: AchievementArtProps["state"];
  readonly symbol: ReactNode;
  readonly tilt: number;
  readonly sparkle: boolean;
};

/** The drop, its highlight and the symbol inside it. Shared by every size. */
function Drop({ uid, state, symbol, tilt, sparkle }: DropProps) {
  const upright = tilt ? ` rotate(${-tilt})` : "";
  if (state === "locked") {
    return (
      <g className="p4-drop">
        <path className="p4-drop__outline" d={DROP} />
        <g className="p4-sym p4-sym--faint" transform={SYMBOL_ORIGIN + upright}>{symbol}</g>
      </g>
    );
  }
  return (
    <g className="p4-drop">
      <path className="p4-drop__body" d={DROP} fill={`url(#${uid}-body)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        <g className="p4-sym" transform={SYMBOL_ORIGIN + upright + " scale(1.1 1.06)"}>{symbol}</g>
      </g>
      <path className="p4-drop__rim" d={DROP} />
      <path className="p4-drop__gloss" d="M38.4 58.6 C38.2 53.6 40.6 49.6 44.2 47.6 C42.6 50.6 41.4 54.4 41.2 58.4 C40.6 59.6 38.8 59.8 38.4 58.6 Z" />
      {sparkle ? <path className="p4-sparkle" d={SPARKLE} transform="translate(45.4 46.4)" /> : null}
    </g>
  );
}

/** Pool radius per milestone; one-time achievements fill the dish. */
const POOL_RX = [25.4, 9, 12.4, 15.6, 18.8, 22, 25.4] as const;
const DISH_INNER = { cx: 50, cy: 85.5, rx: 26.4, ry: 4.7 } as const;

/** A second cue per group, inside the dish: rhythm's time of day reflected in the pool,
 *  consistency's measuring marks, unexpected's off-centre splash. */
function GroupCue({ id, group }: { readonly id: AchievementArtProps["id"]; readonly group: AchievementArtProps["group"] }) {
  if (group === "rhythm") {
    if (id === "earlyStart") return <ellipse className="p4-cue p4-cue--sun" cx="64" cy="86.2" rx="5.2" ry="1.6" />;
    if (id === "nightOwl") return <path className="p4-cue p4-cue--moon" d={MOON} transform="translate(64 86.2) scale(0.62 0.2)" />;
    return null;
  }
  if (group === "consistency") {
    return <path className="p4-cue-line" d="M25.4 88.4 L25.4 91 M29 89.6 L29 92.6 M71 89.6 L71 92.6 M74.6 88.4 L74.6 91" />;
  }
  if (group === "unexpected") return <ellipse className="p4-cue-line" cx="60.5" cy="86.4" rx="5" ry="1.2" />;
  return null;
}

/** The milestone shows in the dish: the pool fills, a droplet is collected per milestone, a gold rim at the top. */
function TierPool({ tier, entrance }: { readonly tier: number; readonly entrance: boolean }) {
  const complete = tier === 0;
  const level = Math.min(tier, POOL_RX.length - 1);
  const rx = POOL_RX[level];
  const gold = complete || tier >= POOL_RX.length - 1;
  const step = entrance ? { animationDelay: "1080ms" } : undefined;
  return (
    <g className="p4-ripples">
      <ellipse className="p4-fill" cx="50" cy={DISH_CY} rx={rx} ry={rx * RING_SQUASH} style={step} />
      <ellipse className="p4-ring" cx="50" cy={DISH_CY} rx={rx} ry={rx * RING_SQUASH} style={step} />
      {gold ? <ellipse className="p4-ring p4-ring--gold" cx="50" cy="85" rx="28" ry="5.4" style={entrance ? { animationDelay: "1260ms" } : undefined} /> : null}
      {complete
        ? SPLASH_BEADS.map(([cx, cy, r], i) => (
          <circle key={i} className="p4-bead" cx={cx} cy={cy} r={r} style={entrance ? { animationDelay: "1040ms" } : undefined} />
        ))
        : Array.from({ length: level }, (_, i) => {
          const arc = Math.max(rx - 2.8, 5.6);
          const angle = ((level === 1 ? 90 : 28 + (124 * i) / (level - 1)) * Math.PI) / 180;
          return (
            <g key={i} transform={`translate(${50 + arc * Math.cos(angle)} ${DISH_CY + arc * RING_SQUASH * Math.sin(angle)})`}>
              <g className="p4-bead" style={entrance ? { animationDelay: 1140 + i * 80 + "ms" } : undefined}>
                <ellipse rx="1.8" ry="1.1" />
                <circle className="p4-bead__hi" cx="-0.6" cy="-0.36" r="0.4" />
              </g>
            </g>
          );
        })}
    </g>
  );
}

export function AchievementPotion4({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = domId(useId());
  const earned = state === "earned";
  const concealed = state === "concealed";
  const symbol = concealed ? CONCEALED_SYMBOL : SYMBOLS[id];
  const showGroup = concealed ? undefined : group;
  const tilt = showGroup === "unexpected" ? TILT : 0;
  const animate = entrance && earned && detail;
  const className = "potion4" + (detail ? "" : " potion4--compact") + (animate ? " is-entrance" : "");
  const tiltTransform = tilt ? `rotate(${tilt} 50 62)` : undefined;

  const defs = (
    <defs>
      <radialGradient id={`${uid}-body`} cx="0.42" cy="0.5" r="0.62">
        <stop className="p4-stop-light" offset="0" />
        <stop className="p4-stop-mid" offset="0.7" />
        <stop className="p4-stop-deep" offset="1" />
      </radialGradient>
      <clipPath id={`${uid}-clip`}>
        <path d={DROP} />
      </clipPath>
      <radialGradient id={`${uid}-halo`}>
        <stop className="p4-halo-in" offset="0" />
        <stop className="p4-halo-out" offset="1" />
      </radialGradient>
      <radialGradient id={`${uid}-caustic`}>
        <stop className="p4-caustic-in" offset="0" />
        <stop className="p4-caustic-out" offset="1" />
      </radialGradient>
      <clipPath id={`${uid}-barrel`}>
        <path d={BARREL} />
      </clipPath>
      <clipPath id={`${uid}-pool`}>
        <ellipse {...DISH_INNER} />
      </clipPath>
    </defs>
  );

  if (!detail) {
    return (
      <svg className={className} viewBox="0 0 100 100" data-group={showGroup} data-state={state} aria-hidden="true" focusable="false">
        {defs}
        <g transform={`translate(50 3.4) scale(2.2) translate(-50 ${-DROP_TOP_Y})`}>
          <Drop uid={uid} state={state} symbol={symbol} tilt={0} sparkle={false} />
        </g>
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 100 100" data-group={showGroup} data-state={state} aria-hidden="true" focusable="false">
      {defs}

      {/* Dish: a small, deep petri dish; earned, it holds a thin pool of the same liquid. */}
      <g className="p4-dish">
        <path className="p4-dish__wall" d="M22 85 L22.6 90.4 C23.4 93.8 35 95.6 50 95.6 C65 95.6 76.6 93.8 77.4 90.4 L78 85 Z" />
        <ellipse className="p4-dish__rim" cx="50" cy="85" rx="28" ry="5.4" />
        <ellipse className="p4-dish__inner" cx="50" cy="85.5" rx="26.4" ry="4.7" />
        {state === "concealed" ? <ellipse className="p4-pool" cx="50" cy={DISH_CY} rx="25.4" ry="4.4" /> : null}
        <g clipPath={`url(#${uid}-pool)`}>
          {earned ? <ellipse className="p4-caustic-glow" cx="50" cy={DISH_CY} rx="15" ry="3.4" fill={`url(#${uid}-caustic)`} /> : null}
          {showGroup === "rhythm" ? <GroupCue id={id} group={showGroup} /> : null}
          {earned ? <ellipse className="p4-shadow" cx="50" cy={DISH_CY + 0.3} rx="8" ry="1.6" /> : null}
          {earned ? <ellipse className="p4-caustic" cx="50" cy={DISH_CY} rx="3.4" ry="0.8" /> : null}
        </g>
        {earned ? <TierPool tier={tier} entrance={animate} /> : null}
        {showGroup && showGroup !== "rhythm" ? <GroupCue id={id} group={showGroup} /> : null}
        <path className="p4-dish__lip" d="M25 91.8 C33 94.4 42 94.8 50 94.8 C58 94.8 67 94.4 75 91.8" />
      </g>

      {earned ? <circle className="p4-halo" cx="50" cy="56" r="27" fill={`url(#${uid}-halo)`} /> : null}

      {/* Pipette: a short glass dropper with a soft bulb; the collar turns gold from the fourth milestone. */}
      <g className="p4-pipette" transform="translate(50 26.6) scale(0.74) translate(-50 -34.3)">
        <path className="p4-bulb" d="M45.6 15.4 L45.6 10.8 C45.6 6.4 47.4 4.4 50 4.4 C52.6 4.4 54.4 6.4 54.4 10.8 L54.4 15.4 Z" />
        <path className="p4-bulb__shine" d="M47.4 13.6 L47.4 10.6 C47.4 8.4 48.2 7 49.4 6.4" />
        <path className="p4-barrel" d={BARREL} />
        {state === "locked" ? null : (
          <g clipPath={`url(#${uid}-barrel)`}>
            <rect className="p4-barrel__liquid" x="46" y="25.4" width="8" height="10" />
            <path className="p4-barrel__meniscus" d="M47.3 25.4 Q50 26.4 52.7 25.4" />
          </g>
        )}
        <path className="p4-barrel__edge" d={BARREL} />
        <path className="p4-barrel__shine" d="M48.3 19.6 L48.3 27.6" />
        <path className="p4-barrel__ticks" d="M51.4 20.8 L52.7 20.8 M51.4 22.8 L52.7 22.8" />
        <rect className={"p4-collar" + (earned && tier >= 4 ? " p4-collar--gold" : "")} x="44.6" y="15" width="10.8" height="3.2" rx="1" />
        {state === "locked" || showGroup === "focus" ? null : <circle className="p4-tip-bead" cx="50" cy="35.3" r="1.05" />}
      </g>

      <g transform={dropPlacement(showGroup)}>
        <g transform={tiltTransform}>
          <Drop uid={uid} state={state} symbol={symbol} tilt={tilt} sparkle={animate} />
        </g>
      </g>
    </svg>
  );
}
