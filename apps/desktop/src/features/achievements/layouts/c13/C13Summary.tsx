import type { AchievementSummary } from "../../achievementSummary";

/** One quiet line: how many are held, then what is held by rarity tier (or by medal metal without rarity). */
export function C13Summary({ summary }: { readonly summary: AchievementSummary }) {
  return (
    <p className="c13-summary" data-tier-summary={summary.kind ?? "none"}>
      <span className="c13-summary__count">{summary.held}</span>
      {summary.parts.length > 0 ? (
        <span className="c13-summary__tiers">
          <span className="c13-sr">{summary.partsLabel}</span>
          {summary.parts.map(({ key, name, count }) => (
            <span key={key} className="c13-hold">
              <span className="c13-hold__name">{name}</span>
              <span className="c13-hold__count">{count}</span>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
