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

const stool: Seat = {
  height: 180,
  back: (
    <>
      <path className="ac-s3-stroke" d="M75 122v52M33 156h84" fill="none" strokeWidth="3.5" strokeLinecap="round" />
      <path className="ac-s4-stroke" d="M38 118 30 176M112 118l8 58" fill="none" strokeWidth="5" strokeLinecap="round" />
      <path className="ac-s3" d="M25 112v6a50 7 0 0 0 100 0v-6Z" />
      <ellipse className="ac-accent" cx="75" cy="112" rx="50" ry="7" />
    </>
  ),
};

const donut: Seat = {
  height: 137,
  back: (
    <>
      <path className="ac-s2-stroke" d="M19 108a56 13.5 0 0 1 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
      <ellipse className="ac-s4" cx="75" cy="108" rx="44" ry="8.5" />
    </>
  ),
  front: (
    <>
      <path className="ac-s3-stroke" d="M19 112a56 13.5 0 0 0 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
      <path className="ac-accent-stroke" d="M19 108a56 13.5 0 0 0 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
    </>
  ),
};

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
  focus100h: { pose: "sit", seat: donut, sky: null },
  driftDay: { pose: "sleep", seat: openBox("sleep"), sky: "waves" },
  noDriftDay: { pose: "sit", seat: closedBox, sky: null },
  comeback: { pose: "sit", seat: stool, sky: null },
};

const CONCEALED_SCENE: Scene = { pose: "sleep", seat: ground, sky: null };

/** Every cat is drawn at one size, feet on the same line, so a wall of badges reads as one set. */
const CAT_SCALE = 0.72;
const FEET_Y = 97;
const CAT_TRANSFORM = "translate(" + (75 - 80 * CAT_SCALE) + " " + (FEET_Y - 113 * CAT_SCALE) + ") scale(" + CAT_SCALE + ")";

function SkyArt({ sky }: { readonly sky: Sky }) {
  if (sky === "sun") {
    return (
      <>
        <circle className="ac-accent" cx="38" cy="42" r="23" opacity="0.28" />
        <circle className="ac-accent" cx="38" cy="42" r="15" />
        <rect className="ac-s1" x="0" y={FEET_Y} width="150" height={150 - FEET_Y} />
      </>
    );
  }
  if (sky === "moon") {
    return (
      <>
        <path className="ac-accent" d="M34 22a16 16 0 1 0 17 22.6 13 13 0 1 1-17-22.6Z" />
        <circle className="ac-accent" cx="76" cy="22" r="2.2" />
        <circle className="ac-accent" cx="96" cy="14" r="1.5" />
        <circle className="ac-accent" cx="124" cy="28" r="1.5" />
      </>
    );
  }
  return null;
}

/**
 * Drifty's cat, still, as in Insights' read: pet mode's sitting or sleeping
 * pose drawn as it is, on a seat that tells the achievement. A tile in the
 * achievement's colour holds it; until it is earned the scene stays grey and
 * the cat has no face.
 */
export function AchievementCat({ id, group, state }: AchievementArtProps) {
  const clip = "achievement-cat-" + useId().replace(/:/gu, "");
  const scene = state === "concealed" ? CONCEALED_SCENE : SCENES[id];
  const { pose, seat } = scene;
  return (
    <svg className="achievement-art achievement-cat" viewBox="0 0 150 150" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}><rect x="0" y="0" width="150" height="150" rx="38" /></clipPath>
      </defs>
      <rect className="ac-tile" x="0" y="0" width="150" height="150" rx="38" />
      <g clipPath={"url(#" + clip + ")"}>
      <SkyArt sky={scene.sky} />
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
      </g>
      {state === "concealed" ? <text className="ac-question" x="112" y="52" fontSize="30" textAnchor="middle">?</text> : null}
    </svg>
  );
}
