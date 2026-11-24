import type { AchievementSummary } from "../../achievementSummary";

/** What is held, read as one line: the count, then the tiers (or medal metals) actually held. */
export function C16Summary({ summary, className }: { readonly summary: AchievementSummary; readonly className: string }) {
  return (
    <p className={className} data-tier-summary={summary.kind ?? undefined}>
      <span className="c16-summary__held">{summary.held}</span>
      {summary.parts.length > 0 ? (
        <span className="c16-summary__tiers">
          <span className="c16-sr">{summary.partsLabel}</span>
          {summary.parts.map(({ key, name, count }) => (
            <span key={key} className="c16-hold">
              {name} <span className="c16-hold__count">{count}</span>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
