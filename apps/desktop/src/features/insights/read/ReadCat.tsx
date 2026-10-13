import type { ReactNode } from "react";
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
} from "../../pet-mode/petModeVectorArt";
import { daysBetween } from "./readFormat";

/**
 * What the cat sits on or in. The cat itself is only ever pet mode's own two
 * vector poses, unchanged: sitting on a week with a read, asleep on a week
 * without one. Only what it sits on is drawn here, and that changes each week.
 */
export type ReadCatSeat =
  | "onKraft"
  | "onMonitor"
  | "onBooks"
  | "onStool"
  | "boxKraft"
  | "donut";

type Pose = "sit" | "sleep";

/** The seats in the order a user meets them, one a week from their first read. */
export const READ_CAT_SEATS: readonly ReadCatSeat[] = ["onKraft", "onMonitor", "onBooks", "onStool", "boxKraft", "donut"];

/**
 * Where the cat sits for the read of a given week: the first read gets the
 * first seat and each week after the next one, round and round. It depends
 * only on the two weeks, so a read keeps its seat whenever it is opened.
 */
export function seatForWeek(firstWeekStart: string, weekStart: string): ReadCatSeat {
  const weeks = Math.round(daysBetween(firstWeekStart, weekStart) / 7);
  const count = READ_CAT_SEATS.length;
  return READ_CAT_SEATS[((weeks % count) + count) % count];
}

/**
 * Each seat on the pet's own 150-wide canvas, where the sitting cat's feet and
 * the sleeping cat's belly rest near y 113. "back" is drawn behind the cat and
 * "front" over it, so a box or a bed can hide the legs. Fills are four greys of
 * the card (s1 lightest to s4) and one line colour; warm seats use the same
 * steps of the app's gold.
 */
type SeatArt = { readonly height: number; readonly warm?: boolean; readonly back?: ReactNode; readonly front?: ReactNode };

/** A closed box seen a little from above, tape across its top. */
function closedBox(left: number, right: number, top: number, bottom: number): ReactNode {
  const face = top + 10;
  const inset = 12;
  const mid = (left + right) / 2;
  return (
    <>
      <rect className="rp-s2" x={left} y={face} width={right - left} height={bottom - face} />
      <path className="rp-s1" d={"M" + (left + inset) + " " + top + "H" + (right - inset) + "L" + right + " " + face + "H" + left + "Z"} />
      <path className="rp-s3" d={"M" + (mid - 7) + " " + top + "h14l2 10h-18Z"} />
      <rect className="rp-s3" x={mid - 9} y={face} width="18" height="12" />
    </>
  );
}

/** An open cardboard box the cat sits in; the sleeping cat sits lower and gets no flaps, which would cover its eyes. */
function openBox(pose: Pose, warm: boolean): SeatArt {
  const top = pose === "sit" ? 91 : 102;
  return {
    height: 130,
    warm,
    back: <path className="rp-s4" d={"M16 " + top + "l8-7h102l8 7Z"} />,
    front: (
      <>
        {pose === "sit" ? <path className="rp-s3" d={"M14 " + top + "l-9-9h26l9 9Z M136 " + top + "l9-9h-26l-9 9Z"} /> : null}
        <path className="rp-s2" d={"M14 " + top + "h122l-4 " + (127 - top) + "H18Z"} />
        <path className="rp-sl" d={"M58 " + (top + 9) + "h34"} fill="none" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  };
}

function seatArt(seat: ReadCatSeat, pose: Pose): SeatArt {
  switch (seat) {
    case "onKraft":
      return { height: 174, warm: true, back: closedBox(14, 136, 107, 171) };
    case "onMonitor":
      // On top of a monitor: Drifty's own desk.
      return {
        height: 196,
        back: (
          <>
            <path className="rp-s3" d="M65 178h20l3 11H62Z" />
            <rect className="rp-s4" x="44" y="189" width="62" height="5" rx="2.5" />
            <rect className="rp-s4" x="14" y="112" width="122" height="66" rx="5" />
            <rect className="rp-paper" x="19.5" y="117.5" width="111" height="55" rx="2" />
          </>
        ),
      };
    case "onBooks":
      // Three books, page edges out, a ribbon from the top one: a nod to the read.
      return {
        height: 154,
        back: (
          <>
            <rect className="rp-s3" x="22" y="137.5" width="114" height="14" rx="2.5" />
            <rect className="rp-paper" x="26.5" y="139.5" width="107.5" height="10" rx="1" />
            <path className="rp-sl" d="M27.5 142.8h105.5M27.5 146.1h105.5" fill="none" strokeWidth="0.6" />
            <rect className="rp-s4" x="14" y="124.5" width="118" height="13" rx="2.5" />
            <rect className="rp-paper" x="18.5" y="126.5" width="111.5" height="9" rx="1" />
            <path className="rp-sl" d="M19.5 129.5h109.5M19.5 132.5h109.5" fill="none" strokeWidth="0.6" />
            <rect className="rp-gold" x="20" y="112.5" width="108" height="12" rx="2.5" />
            <rect className="rp-paper" x="24.5" y="114.5" width="101.5" height="8" rx="1" />
            <path className="rp-sl" d="M25.5 117.2h99.5M25.5 119.8h99.5" fill="none" strokeWidth="0.6" />
            <path className="rp-gold" d="M100 124.5h5v8l-2.5-2-2.5 2Z" />
          </>
        ),
      };
    case "onStool":
      return {
        height: 180,
        back: (
          <>
            <path className="rp-s3-stroke" d="M75 122v52M33 156h84" fill="none" strokeWidth="3.5" strokeLinecap="round" />
            <path className="rp-s4-stroke" d="M38 118 30 176M112 118l8 58" fill="none" strokeWidth="5" strokeLinecap="round" />
            <path className="rp-s3" d="M25 112v6a50 7 0 0 0 100 0v-6Z" />
            <ellipse className="rp-s1" cx="75" cy="112" rx="50" ry="7" />
          </>
        ),
      };
    case "boxKraft":
      return openBox(pose, true);
    case "donut":
      // A round bed with a plump rim: the cat sits in the hollow and the front of the rim covers its feet.
      return {
        height: 137,
        back: (
          <>
            <path className="rp-s2-stroke" d="M19 108a56 13.5 0 0 1 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
            <ellipse className="rp-s4" cx="75" cy="108" rx="44" ry="8.5" />
          </>
        ),
        front: (
          <>
            <path className="rp-s3-stroke" d="M19 112a56 13.5 0 0 0 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
            <path className="rp-s1-stroke" d="M19 108a56 13.5 0 0 0 112 0" fill="none" strokeWidth="13" strokeLinecap="round" />
          </>
        ),
      };
  }
}

/**
 * Drifty's cat, still, beside the read: pet mode's sitting pose when the week
 * has a read and its sleeping pose when it does not, drawn as they are. One
 * flat grey coat with no outline; its colours come from the read card so the
 * cat sits in the card rather than on it.
 */
export function ReadCat({ pose, seat }: { readonly pose: Pose; readonly seat: ReadCatSeat }) {
  const art = seatArt(seat, pose);
  return (
    <svg className={"rp-cat is-" + pose + " seat-" + seat + (art.warm ? " is-warm" : "")} viewBox={"0 0 150 " + art.height} aria-hidden="true" focusable="false">
      {art.back}
      {pose === "sit" ? (
        <>
          <path className="rp-cat__fur" d={PET_MODE_SIT_BODY_PATH} />
          <g className="rp-cat__face" transform={PET_MODE_SIT_FACE_TRANSFORM}>
            {PET_MODE_FACE_EYES.map((eye) => <circle key={eye.cx} cx={eye.cx} cy={eye.cy} r={PET_MODE_FACE_EYE_RADIUS} fill="currentColor" />)}
            <path d={PET_MODE_FACE_MOUTH_PATH} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      ) : (
        <>
          <path className="rp-cat__fur" d={PET_MODE_SLEEP_BODY_PATH} />
          <g className="rp-cat__face" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d={PET_MODE_SLEEP_EYE_FRONT_PATH} strokeWidth="2.2" />
            <path d={PET_MODE_SLEEP_EYE_REAR_PATH} strokeWidth="2.2" />
            <path d={PET_MODE_SLEEP_MOUTH_PATH} strokeWidth="1.9" />
          </g>
        </>
      )}
      {art.front}
    </svg>
  );
}
