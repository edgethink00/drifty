import type { AchievementArtProps } from "./achievementArt";

/** Set like a figure in print: the goal in the serif face over a short rule, solid once earned and an outline until then. */
export function AchievementNumeral({ group, state, detail, mark }: AchievementArtProps) {
  const length = mark.text.length + (mark.unit ? 0.5 : 0);
  const size = length <= 1.5 ? 56 : length <= 2 ? 52 : length <= 2.5 ? 44 : length <= 3 ? 37 : length <= 3.5 ? 32 : 28;
  return (
    <svg className="achievement-art achievement-numeral" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <text className="achievement-numeral__figure" x="50" y={(detail ? 46 : 50) + size * 0.34} fontSize={size} textAnchor="middle">
        {mark.text}
        {mark.unit ? <tspan className="achievement-numeral__unit" fontSize={size * 0.42} dx={size * 0.03}>{mark.unit}</tspan> : null}
      </text>
      {detail ? <path className="achievement-numeral__rule" d="M36 83H64" /> : null}
    </svg>
  );
}
