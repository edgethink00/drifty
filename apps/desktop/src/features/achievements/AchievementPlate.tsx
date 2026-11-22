import { useId, useMemo } from "react";
import { ACHIEVEMENT_GLYPH_PATHS, type AchievementGlyphName } from "./AchievementGlyph";
import type { AchievementGroup } from "./achievementCatalog";
import { PLATE_PATHS, PLATE_SHAPE_BY_GROUP, plateVeils } from "./achievementPlateArt";

export type AchievementPlateState = "earned" | "locked" | "concealed";

type AchievementPlateProps = {
  readonly group: AchievementGroup;
  readonly state: AchievementPlateState;
  readonly glyph: AchievementGlyphName;
  /** Stable per achievement; chooses its line pattern. */
  readonly seed: string;
};

/**
 * A dark plate lit in its group's colour: outline, strung lines and a small
 * mark. The count that sits across its lower edge is drawn by the caller.
 */
export function AchievementPlate({ group, state, glyph, seed }: AchievementPlateProps) {
  const id = useId().replace(/:/gu, "");
  const path = PLATE_PATHS[PLATE_SHAPE_BY_GROUP[group]];
  const veils = useMemo(() => plateVeils(seed), [seed]);
  const earned = state === "earned";
  return (
    <svg className="achievement-plate" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={"plate-clip-" + id}><path d={path} /></clipPath>
        <linearGradient id={"plate-fill-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--plate-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--plate-bottom)" }} />
        </linearGradient>
        <radialGradient id={"plate-halo-" + id}>
          <stop offset="0" style={{ stopColor: "var(--plate-accent)", stopOpacity: 0.42 }} />
          <stop offset="1" style={{ stopColor: "var(--plate-accent)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={"plate-gloss-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <filter id={"plate-glow-" + id} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      {earned ? <path d={path} className="achievement-plate__glow" filter={"url(#plate-glow-" + id + ")"} /> : null}
      <path d={path} fill={"url(#plate-fill-" + id + ")"} />
      <g clipPath={"url(#plate-clip-" + id + ")"}>
        {earned ? veils.map((line, index) => (
          <line key={index} className="achievement-plate__veil" x1={line[0].toFixed(2)} y1={line[1].toFixed(2)} x2={line[2].toFixed(2)} y2={line[3].toFixed(2)} />
        )) : null}
        {earned ? <circle cx="50" cy="42" r="24" fill={"url(#plate-halo-" + id + ")"} /> : null}
        <rect x="0" y="0" width="100" height="50" fill={"url(#plate-gloss-" + id + ")"} />
      </g>
      <path d={path} className="achievement-plate__edge" />
      <path d={path} className="achievement-plate__inner" transform="translate(50 50) scale(0.86) translate(-50 -50)" />
      <g className="achievement-plate__glyph" transform="translate(50 41) scale(1.2) translate(-12 -12)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ACHIEVEMENT_GLYPH_PATHS[glyph].map((d) => <path key={d} d={d} />)}
      </g>
    </svg>
  );
}
