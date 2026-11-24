import type { AchievementSummary } from "../../achievementSummary";

type Props = {
  readonly summary: AchievementSummary;
  readonly className: string;
  /** Off where a title already says how many: only the tiers are left. */
  readonly showHeld?: boolean;
};

/** What is held, read as one line: the count, then the tiers (or medal metals) actually held. */
export function C16Summary({ summary, className, showHeld = true }: Props) {
  if (!showHeld && summary.parts.length === 0) return null;
  return (
    <p className={className} data-tier-summary={summary.kind ?? undefined}>
      {showHeld ? <span className="c16-summary__held">{summary.held}</span> : null}
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
