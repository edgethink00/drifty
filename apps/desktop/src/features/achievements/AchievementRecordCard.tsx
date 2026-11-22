import { ACHIEVEMENT_GLYPH_PATHS } from "./AchievementGlyph";
import type { AchievementArtProps, AchievementFigure } from "./achievementArt";

function figureSize(figure: AchievementFigure): number {
  const length = figure.text.length + (figure.unit ? 0.6 : 0);
  return length <= 1.6 ? 40 : length <= 2.6 ? 34 : length <= 3.6 ? 27 : 23;
}

/**
 * A card with the person's own figure from the day, set large as Wrapped
 * sets minutes listened: the run, the hours or the share that earned it.
 * Until earned the card is an outline holding the goal.
 */
export function AchievementRecordCard({ id, group, state, detail, goal, record }: AchievementArtProps) {
  const earned = state === "earned";
  const figure = earned && record ? record : goal;
  const size = figureSize(figure);
  const glyph = ACHIEVEMENT_GLYPH_PATHS[state === "concealed" ? "hidden" : id];
  return (
    <svg className="achievement-art achievement-record" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <rect className="arc-card" x="12" y="4" width="76" height="92" rx="13" />
      <g className="arc-glyph" transform="translate(21 13) scale(0.62)">
        {glyph.map((d) => <path key={d} d={d} />)}
      </g>
      {detail ? (
        <text className="arc-figure" x="50" y={70} fontSize={size} textAnchor="middle">
          {figure.text}
          {figure.unit ? <tspan className="arc-unit" fontSize={size * 0.46} dx={size * 0.04}>{figure.unit}</tspan> : null}
        </text>
      ) : null}
    </svg>
  );
}
