import type { AchievementSummary } from "../../achievementSummary";

/** What is held, by rarity tier when every held one has a rarity, else by medal metal; tiers not held are left out. */
export function C14Holdings({ summary, className }: { readonly summary: AchievementSummary; readonly className: string }) {
  if (summary.parts.length === 0) return null;
  return (
    <p className={className} data-tier-summary={summary.kind ?? undefined}>
      <span className="c14-sr">{summary.partsLabel}</span>
      {summary.parts.map(({ key, name, count }) => (
        <span key={key} className="c14-hold">
          <span className="c14-hold__name">{name}</span>
          <span className="c14-hold__count">{count}</span>
        </span>
      ))}
    </p>
  );
}
