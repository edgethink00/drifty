import { useId, type ReactNode } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";

const PAPER = "achievement-poster__paper";
const TINT = "achievement-poster__tint";
const PAPER_LINE = "achievement-poster__paper-line";
const TINT_LINE = "achievement-poster__tint-line";
const GROUND = "achievement-poster__ground";

const WAVE = "q6.25 -7.5 12.5 0t12.5 0t12.5 0t12.5 0t12.5 0t12.5 0t12.5 0t12.5 0";

/**
 * One flat composition per achievement. Each group keeps to one idea: focus
 * spreads in rings, rhythm is the sun and moon over a horizon, consistency
 * counts in bars and dots, and the unexpected ones are water, rough or still.
 */
const COMPOSITIONS: Record<AchievementId, ReactNode> = {
  firstFlow: (
    <>
      <circle className={PAPER} cx="50" cy="50" r="7.5" />
      <circle className={PAPER_LINE} cx="50" cy="50" r="21" strokeWidth="5" />
    </>
  ),
  flow90: (
    <>
      <circle className={PAPER} cx="50" cy="50" r="6.5" />
      <circle className={PAPER_LINE} cx="50" cy="50" r="17.5" strokeWidth="4.6" />
      <circle className={TINT_LINE} cx="50" cy="50" r="29.5" strokeWidth="4.6" />
    </>
  ),
  flow180: (
    <>
      <circle className={PAPER} cx="50" cy="50" r="5.5" />
      <circle className={PAPER_LINE} cx="50" cy="50" r="14.5" strokeWidth="4" />
      <circle className={TINT_LINE} cx="50" cy="50" r="25" strokeWidth="4" />
      <circle className={PAPER_LINE} cx="50" cy="50" r="35.5" strokeWidth="4" />
    </>
  ),
  focusDay8h: (
    <>
      <circle className={PAPER} cx="50" cy="50" r="23" />
      <circle className={TINT_LINE} cx="50" cy="50" r="35" strokeWidth="5" />
    </>
  ),
  earlyStart: (
    <>
      <path className={PAPER} d="M29 61A21 21 0 0 1 71 61Z" />
      <path className={TINT_LINE} d="M17 61A33 33 0 0 1 83 61" strokeWidth="4" />
      <rect className={GROUND} x="0" y="61" width="100" height="39" />
    </>
  ),
  nightOwl: (
    <>
      <circle className={PAPER} cx="47" cy="41" r="20" />
      <circle className="achievement-poster__disc" cx="56.5" cy="34.5" r="17" />
      <circle className={TINT} cx="74" cy="56" r="2.6" />
      <circle className={TINT} cx="27" cy="22" r="1.9" />
      <rect className={GROUND} x="0" y="72" width="100" height="28" />
    </>
  ),
  weekendShift: (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => (
        <rect key={day} className={day > 4 ? PAPER : TINT} x={14.5 + day * 10.5} y={day > 4 ? 30 : 52} width="7.5" height={day > 4 ? 40 : 18} />
      ))}
      <rect className={GROUND} x="0" y="70" width="100" height="30" />
    </>
  ),
  streak7: (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((step) => (
        <rect key={step} className={step === 6 ? PAPER : TINT} x={14.5 + step * 10.5} y={66 - step * 7} width="7.5" height={12 + step * 7} />
      ))}
    </>
  ),
  streak30: (
    <>
      {Array.from({ length: 30 }, (_, index) => (
        <circle key={index} className={index === 29 ? PAPER : TINT} cx={25 + (index % 6) * 10} cy={30 + Math.floor(index / 6) * 10} r="3.2" />
      ))}
    </>
  ),
  focus100h: (
    <>
      <rect className={PAPER} x="15.5" y="35" width="7.5" height="30" />
      <circle className={PAPER_LINE} cx="42.5" cy="50" r="11.3" strokeWidth="7.4" />
      <circle className={PAPER_LINE} cx="74" cy="50" r="11.3" strokeWidth="7.4" />
    </>
  ),
  driftDay: (
    <>
      <path className={PAPER_LINE} d={"M0 35" + WAVE} strokeWidth="6.5" />
      <path className={TINT_LINE} d={"M-6 50" + WAVE} strokeWidth="6.5" />
      <path className={PAPER_LINE} d={"M0 65" + WAVE} strokeWidth="6.5" />
    </>
  ),
  noDriftDay: (
    <>
      <path className={PAPER_LINE} d="M0 35H100" strokeWidth="6.5" />
      <path className={TINT_LINE} d="M0 50H100" strokeWidth="6.5" />
      <path className={PAPER_LINE} d="M0 65H100" strokeWidth="6.5" />
    </>
  ),
  comeback: (
    <>
      <path className={TINT_LINE} d="M8 36L36 64" strokeWidth="7.5" />
      <path className={PAPER_LINE} d="M33.3 61.3L74 26" strokeWidth="7.5" />
      <path className={PAPER_LINE} d="M52 25.5H76.5V50" strokeWidth="7.5" />
    </>
  ),
};

/** A flat disc in the group's colour, carrying a composition cut from two paper tones. */
export function AchievementPoster({ id, group, state }: AchievementArtProps) {
  const clipId = "poster-clip-" + useId().replace(/:/gu, "");
  return (
    <svg className="achievement-art achievement-poster" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}><circle cx="50" cy="50" r="47" /></clipPath>
      </defs>
      <circle className="achievement-poster__disc" cx="50" cy="50" r="47" />
      <g clipPath={"url(#" + clipId + ")"}>
        {state === "concealed"
          ? <text className="achievement-poster__question" x="50" y="63" fontSize="38" textAnchor="middle">?</text>
          : COMPOSITIONS[id]}
      </g>
      <circle className="achievement-poster__edge" cx="50" cy="50" r="47" />
    </svg>
  );
}
