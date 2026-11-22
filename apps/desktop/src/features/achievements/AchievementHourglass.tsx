import { useId } from "react";
import { ACHIEVEMENT_GLYPH_PATHS } from "./AchievementGlyph";
import type { AchievementArtProps } from "./achievementArt";

const TOP = "M23 22H77L50 49.2Z";
const BOTTOM = "M50 50.8 77 78H23Z";
const TIERS = 6;

/**
 * Drifty's mark is an hourglass, and every achievement is one. Sand that has
 * fallen is the way already come: an earned achievement's lower half is full,
 * and what is left above runs toward its next milestone, counted in dots
 * below. Until earned, the fallen sand is the progress so far.
 */
export function AchievementHourglass({ id, group, state, detail, progress, tier }: AchievementArtProps) {
  const clip = "hourglass-" + useId().replace(/:/gu, "");
  const earned = state === "earned";
  const fallen = earned ? 1 : progress;
  const left = earned ? (tier > 0 ? 1 - progress : 0) : 1 - progress;
  const glyph = ACHIEVEMENT_GLYPH_PATHS[state === "concealed" ? "hidden" : id];
  return (
    <svg className="achievement-art achievement-hourglass" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip + "-top"}><path d={TOP} /></clipPath>
        <clipPath id={clip + "-bottom"}><path d={BOTTOM} /></clipPath>
      </defs>
      <rect className="ahg-tile" x="2" y="2" width="96" height="96" rx="26" />
      <path className="ahg-glass" d={TOP} />
      <path className="ahg-glass" d={BOTTOM} />
      <rect className="ahg-sand ahg-sand--left" x="20" y={49.2 - 27.2 * left} width="60" height={27.2 * left} clipPath={"url(#" + clip + "-top)"} />
      <rect className="ahg-sand" x="20" y={78 - 27.2 * fallen} width="60" height={27.2 * fallen} clipPath={"url(#" + clip + "-bottom)"} />
      {detail ? (
        <g className="ahg-glyph" transform="translate(50 67.5) scale(0.5) translate(-12 -12)">
          {glyph.map((d) => <path key={d} d={d} />)}
        </g>
      ) : null}
      {detail && earned && tier > 0
        ? Array.from({ length: TIERS }, (_, index) => (
          <circle key={index} className={"ahg-tier" + (index < tier ? " is-reached" : "")} cx={50 + (index - (TIERS - 1) / 2) * 6} cy="88" r="1.7" />
        ))
        : null}
    </svg>
  );
}
