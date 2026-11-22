import { useId, type ReactNode } from "react";
import {
  PET_MODE_FACE_EYES,
  PET_MODE_FACE_EYE_RADIUS,
  PET_MODE_FACE_MOUTH_PATH,
  PET_MODE_SIT_BODY_PATH,
  PET_MODE_SIT_FACE_TRANSFORM,
  PET_MODE_SLEEP_BODY_PATH,
  PET_MODE_SLEEP_EYE_FRONT_PATH,
  PET_MODE_SLEEP_EYE_REAR_PATH,
  PET_MODE_SLEEP_MOUTH_PATH,
} from "../pet-mode/petModeVectorArt";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";

type Pose = "sit" | "sleep";

/**
 * What the cat sits on, on pet mode's own 150-wide canvas where the sitting
 * cat's feet and the sleeping cat's belly rest near y 113, as in Insights'
 * read. "back" is drawn behind the cat and "front" over it.
 */
type Seat = { readonly height: number; readonly back?: ReactNode; readonly front?: ReactNode };

/** Behind the seat, on the badge's own 150 × 150 tile. */
type Sky = "sun" | "moon" | "waves" | null;

type Scene = { readonly pose: Pose; readonly seat: Seat; readonly sky: Sky };

const ground: Seat = { height: 122, back: <rect className="ac-s2" x="6" y="112" width="138" height="6" rx="3" /> };

function books(count: 1 | 3): Seat {
  const shelf = [
    { x: 22, y: 137.5, width: 114, cover: "ac-s3" },
    { x: 14, y: 124.5, width: 118, cover: "ac-s4" },
    { x: 20, y: 112.5, width: 108, cover: "ac-accent" },
  ].slice(3 - count);
  return {
    height: 112.5 + count * 13 + 3,
    back: (
      <>
        {shelf.map((book) => (
          <g key={book.y}>
            <rect className={book.cover} x={book.x} y={book.y} width={book.width} height="13" rx="2.5" />
            <rect className="ac-paper" x={book.x + 4.5} y={book.y + 2} width={book.width - 6.5} height="9" rx="1" />
            <path className="ac-sl" d={"M" + (book.x + 5.5) + " " + (book.y + 5) + "h" + (book.width - 8.5) + "M" + (book.x + 5.5) + " " + (book.y + 8) + "h" + (book.width - 8.5)} fill="none" strokeWidth="0.6" />
          </g>
        ))}
        <path className="ac-accent" d={"M100 " + (112.5 + 12) + "h5v8l-2.5-2-2.5 2Z"} />
      </>
    ),
  };
}

/** A monitor a little shorter than the read's, so its stand stays inside the tile. */
const monitor: Seat = {
  height: 178,
  back: (
    <>
      <path className="ac-s3" d="M65 162h20l3 10H62Z" />
      <rect className="ac-s4" x="44" y="172" width="62" height="5" rx="2.5" />
      <rect className="ac-s4" x="14" y="112" width="122" height="50" rx="5" />
      <rect className="ac-paper" x="19.5" y="117.5" width="111" height="39" rx="2" />
      <path className="ac-accent" d="M28 151l14-8 12 5 14-13 12 7 16-11 10 5v19H28Z" opacity="0.55" />
    </>
  ),
};

const closedBox: Seat = {
  height: 174,
  back: (
    <>
      <rect className="ac-s2" x="14" y="117" width="122" height="54" />
      <path className="ac-s1" d="M26 107H124L136 117H14Z" />
      <path className="ac-s3" d="M68 107h14l2 10h-18Z" />
      <rect className="ac-s3" x="66" y="117" width="18" height="12" />
    </>
  ),
};

function openBox(pose: Pose): Seat {
  const top = pose === "sit" ? 91 : 102;
  return {
    height: 130,
    back: <path className="ac-s4" d={"M16 " + top + "l8-7h102l8 7Z"} />,
    front: (
      <>
        {pose === "sit" ? <path className="ac-s3" d={"M14 " + top + "l-9-9h26l9 9Z M136 " + top + "l9-9h-26l-9 9Z"} /> : null}
        <path className="ac-s2" d={"M14 " + top + "h122l-4 " + (127 - top) + "H18Z"} />
        <path className="ac-sl" d={"M58 " + (top + 9) + "h34"} fill="none" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  };
}

/** A desk calendar with one square for each day of the run, all of them ticked. */
function calendar(days: 7 | 30): Seat {
  const columns = days === 7 ? 7 : 10;
  const cell = days === 7 ? 11 : 8;
  const gap = days === 7 ? 4 : 3;
  const width = columns * cell + (columns - 1) * gap;
  const left = 75 - width / 2;
  const top = 134 + (days === 7 ? 8 : 0);
  return {
    height: 178,
    back: (
      <>
        <rect className="ac-s4" x="16" y="112" width="118" height="62" rx="6" />
        <rect className="ac-paper" x="21" y="124" width="108" height="45" rx="2.5" />
        <rect className="ac-accent" x="16" y="112" width="118" height="10" rx="4" />
        {Array.from({ length: days }, (_, index) => (
          <rect key={index} className="ac-accent" x={left + (index % columns) * (cell + gap)} y={top + Math.floor(index / columns) * (cell + gap)} width={cell} height={cell} rx="2" />
        ))}
      </>
    ),
  };
}

/** Three steps up to the right, the cat on the top one: back on course. */
const stairs: Seat = {
  height: 166,
  back: (
    <>
      {[{ x: 6, y: 148 }, { x: 32, y: 130 }, { x: 58, y: 112 }].map((step) => (
        <g key={step.y}>
          <rect className="ac-s3" x={step.x} y={step.y} width={136 - step.x} height="18" />
          <rect className={step.y === 112 ? "ac-accent" : "ac-s1"} x={step.x} y={step.y} width={136 - step.x} height="4" />
        </g>
      ))}
    </>
  ),
};

/** Drifty's own mark as an hourglass, its sand run through: a hundred hours. */
const hourglass: Seat = {
  height: 184,
  back: (
    <>
      <path className="ac-s2" d="M30 112H120L75 147Z" />
      <path className="ac-accent" d="M66 140H84L75 147Z" />
      <path className="ac-accent" d="M75 148 120 183H30Z" />
    </>
  ),
};

/** A round rug marked like a target, the cat right in its middle: a day with no drift. */
const target: Seat = {
  height: 130,
  back: (
    <>
      <ellipse className="ac-s3" cx="78" cy="116" rx="66" ry="14" />
      <ellipse className="ac-paper" cx="78" cy="114" rx="62" ry="12.5" />
      <ellipse className="ac-accent" cx="78" cy="114" rx="47" ry="9.5" />
      <ellipse className="ac-paper" cx="78" cy="114" rx="33" ry="6.7" />
      <ellipse className="ac-accent" cx="78" cy="114" rx="18" ry="3.8" />
    </>
  ),
};

const SCENES: Record<AchievementId, Scene> = {
  firstFlow: { pose: "sit", seat: books(1), sky: null },
  flow90: { pose: "sit", seat: books(3), sky: null },
  flow180: { pose: "sit", seat: monitor, sky: null },
  focusDay8h: { pose: "sleep", seat: openBox("sleep"), sky: null },
  earlyStart: { pose: "sit", seat: ground, sky: "sun" },
  nightOwl: { pose: "sit", seat: closedBox, sky: "moon" },
  weekendShift: { pose: "sit", seat: openBox("sit"), sky: null },
  streak7: { pose: "sit", seat: calendar(7), sky: null },
  streak30: { pose: "sit", seat: calendar(30), sky: null },
  focus100h: { pose: "sit", seat: hourglass, sky: null },
  driftDay: { pose: "sleep", seat: openBox("sleep"), sky: "waves" },
  noDriftDay: { pose: "sit", seat: target, sky: null },
  comeback: { pose: "sit", seat: stairs, sky: null },
};

const CONCEALED_SCENE: Scene = { pose: "sleep", seat: ground, sky: null };

/** Small props for the empty top of the tile, each saying what the scene is about. */
const STORY_PROPS: Partial<Record<AchievementId, ReactNode>> = {
  firstFlow: (
    <g transform="translate(32 44) scale(1.35)">
      <path className="ac-accent" d="M0 -6c0-7 5-11 11-11 0 7-5 11-11 11Z" />
      <path className="ac-accent" d="M0 -3c0-6-4-9-9-9 0 6 4 9 9 9Z" opacity="0.75" />
      <path className="ac-s4" d="M-8 0h16l-3 12h-10Z" />
    </g>
  ),
  flow90: <Clock turn={0.5} />,
  flow180: <Clock turn={1} />,
  focusDay8h: (
    <g className="ac-zz">
      <text x="103" y="40" fontSize="15">z</text>
      <text x="115" y="29" fontSize="11">z</text>
    </g>
  ),
  weekendShift: (
    <g transform="translate(18 20) scale(1.3)">
      <rect className="ac-paper" width="30" height="24" rx="3" />
      <rect className="ac-s4" width="30" height="6" rx="2" />
      {[0, 1, 2, 3, 4].map((day) => <circle key={day} className="ac-s3" cx={4 + day * 3.4} cy="15" r="1.1" />)}
      <rect className="ac-accent" x="19.5" y="10" width="4.6" height="10" rx="1.2" />
      <rect className="ac-accent" x="25" y="10" width="4.6" height="10" rx="1.2" />
    </g>
  ),
  driftDay: (
    <>
      <path className="ac-s2" d="M22 38a8 8 0 0 1 15-4 6 6 0 0 1 9 5H22Z" />
      <path className="ac-gull" d="M58 26q4-4 7 0q3-4 7 0" />
      <path className="ac-gull" d="M70 40q3-3 5.5 0q2.5-3 5.5 0" />
    </>
  ),
  comeback: (
    <g transform="translate(26 22)">
      <path className="ac-clock-hand" d="M0 0V30" />
      <path className="ac-accent" d="M1 1h17l-5 6 5 6H1Z" />
    </g>
  ),
};

/** A clock whose rim fills as far as the stretch ran: half way for ninety minutes, all the way for three hours. */
function Clock({ turn }: { readonly turn: number }) {
  const cx = 36;
  const cy = 37;
  const r = 12;
  const end = [cx + r * Math.sin(turn * Math.PI * 2), cy - r * Math.cos(turn * Math.PI * 2)];
  return (
    <g>
      <circle className="ac-paper" cx={cx} cy={cy} r={r + 1.5} />
      <circle className="ac-clock-rim" cx={cx} cy={cy} r={r} />
      {turn >= 1
        ? <circle className="ac-clock-run" cx={cx} cy={cy} r={r} />
        : <path className="ac-clock-run" d={"M" + cx + " " + (cy - r) + "A" + r + " " + r + " 0 " + (turn > 0.5 ? 1 : 0) + " 1 " + end[0].toFixed(2) + " " + end[1].toFixed(2)} />}
      <path className="ac-clock-hand" d={"M" + cx + " " + (cy - 6.5) + "V" + cy + "l4.5 2.5"} />
    </g>
  );
}

/** Every cat is drawn at one size, feet on the same line, so a wall of badges reads as one set. */
const CAT_SCALE = 0.72;
const FEET_Y = 97;
const CAT_TRANSFORM = "translate(" + (75 - 80 * CAT_SCALE) + " " + (FEET_Y - 113 * CAT_SCALE) + ") scale(" + CAT_SCALE + ")";

function SkyArt({ sky }: { readonly sky: Sky }) {
  if (sky === "sun") {
    return (
      <>
        <circle className="ac-accent" cx="27" cy={FEET_Y} r="26" opacity="0.22" />
        <circle className="ac-accent" cx="27" cy={FEET_Y} r="17" />
        <rect className="ac-s1" x="0" y={FEET_Y} width="150" height={150 - FEET_Y} />
      </>
    );
  }
  if (sky === "moon") {
    return (
      <>
        <path className="ac-accent" d="M34 22a16 16 0 1 0 17 22.6 13 13 0 1 1-17-22.6Z" />
        <circle className="ac-accent" cx="70" cy="20" r="2.2" />
        <circle className="ac-accent" cx="86" cy="34" r="1.5" />
        <circle className="ac-accent" cx="62" cy="40" r="1.5" />
      </>
    );
  }
  return null;
}

/** Sky, seat and cat on the badge's own 150 × 150 tile, without the tile itself. */
function CatScene({ scene, story }: { readonly scene: Scene; readonly story?: ReactNode }) {
  const { pose, seat } = scene;
  return (
    <>
      <SkyArt sky={scene.sky} />
      {story}
      <g transform={CAT_TRANSFORM}>
        {seat.back}
        {pose === "sit" ? (
          <>
            <path className="ac-fur" d={PET_MODE_SIT_BODY_PATH} />
            <g className="ac-face" transform={PET_MODE_SIT_FACE_TRANSFORM}>
              {PET_MODE_FACE_EYES.map((eye) => <circle key={eye.cx} cx={eye.cx} cy={eye.cy} r={PET_MODE_FACE_EYE_RADIUS} fill="currentColor" />)}
              <path d={PET_MODE_FACE_MOUTH_PATH} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </>
        ) : (
          <>
            <path className="ac-fur" d={PET_MODE_SLEEP_BODY_PATH} />
            <g className="ac-face" fill="none" stroke="currentColor" strokeLinecap="round">
              <path d={PET_MODE_SLEEP_EYE_FRONT_PATH} strokeWidth="2.2" />
              <path d={PET_MODE_SLEEP_EYE_REAR_PATH} strokeWidth="2.2" />
              <path d={PET_MODE_SLEEP_MOUTH_PATH} strokeWidth="1.9" />
            </g>
          </>
        )}
        {seat.front}
      </g>
      {scene.sky === "waves" ? (
        <>
          <path className="ac-waves" d="M0 101q9.4-6 18.8 0t18.8 0 18.8 0 18.8 0 18.8 0 18.8 0 18.8 0 18.8 0V150H0Z" />
          <path className="ac-waves-line" d="M-9 120q9.4-5 18.8 0t18.8 0 18.8 0 18.8 0 18.8 0 18.8 0 18.8 0 18.8 0 18.8 0" />
        </>
      ) : null}
    </>
  );
}

/** Where the seat meets the floor on the tile, for the shadow under it. */
function floorY(scene: Scene): number {
  return FEET_Y + (scene.seat.height - 115) * CAT_SCALE;
}

/**
 * Drifty's cat, still, as in Insights' read: pet mode's sitting or sleeping
 * pose drawn as it is, on a seat that tells the achievement, with a small prop
 * above it. A softly lit tile in the achievement's colour holds it; until it
 * is earned the scene stays grey and the cat has no face. An achievement
 * earned again and again gains a gold rim at 5, 10 and 25 times.
 */
export function AchievementCat({ id, group, state, tier, detail }: AchievementArtProps) {
  const uid = "achievement-cat-" + useId().replace(/:/gu, "");
  const scene = state === "concealed" ? CONCEALED_SCENE : SCENES[id];
  const earned = state === "earned";
  const rimTier = earned ? Math.min(tier, 4) : 0;
  const story = detail && state !== "concealed" ? STORY_PROPS[id] : undefined;

  return (
    <svg className="achievement-art achievement-scene achievement-cat" viewBox="0 0 150 150" data-group={group} data-state={state} data-tier={rimTier >= 2 ? rimTier : undefined} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={uid}><rect x="0" y="0" width="150" height="150" rx="38" /></clipPath>
        <radialGradient id={uid + "-glow"} cx="50%" cy="40%" r="65%">
          <stop offset="0" style={{ stopColor: "var(--ac-glow)" }} />
          <stop offset="1" style={{ stopColor: "var(--ac-tile)" }} />
        </radialGradient>
      </defs>
      <rect className="ac-tile" x="0" y="0" width="150" height="150" rx="38" style={{ fill: "url(#" + uid + "-glow)" }} />
      <g clipPath={"url(#" + uid + ")"}>
        {scene.sky !== "waves" ? <ellipse className="ac-floor-shadow" cx="78" cy={floorY(scene)} rx="48" ry="4.5" /> : null}
        <CatScene scene={scene} story={story} />
      </g>
      {rimTier >= 2 ? <rect className="ac-tier-rim" x="2.5" y="2.5" width="145" height="145" rx="35.5" /> : null}
      {rimTier >= 4 ? <rect className="ac-tier-rim ac-tier-rim--inner" x="9.5" y="9.5" width="131" height="131" rx="29" /> : null}
      {state === "concealed" ? <text className="ac-question" x="112" y="52" fontSize="30" textAnchor="middle">?</text> : null}
    </svg>
  );
}
