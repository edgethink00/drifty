import type { AchievementSummary } from "../../achievementSummary";

/** How many are held, then the same count by rarity tier when every held one has a rarity, else by medal metal. */
export function C15Summary({ summary, className }: { readonly summary: AchievementSummary; readonly className: string }) {
  return (
    <div className={className} data-tier-summary={summary.kind ?? "none"}>
      <p className="c15-summary__count">{summary.held}</p>
      {summary.parts.length > 0 ? (
        <p className="c15-summary__tiers">
          <span className="c15-sr">{summary.partsLabel}</span>
          {summary.parts.map(({ key, name, count }) => (
            <span key={key} className="c15-hold">
              <span className="c15-hold__name">{name}</span>
              <span className="c15-hold__count">{count}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
