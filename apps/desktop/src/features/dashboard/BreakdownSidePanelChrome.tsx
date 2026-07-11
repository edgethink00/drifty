import type { ReactNode } from "react";

type BreakdownSidePanelProps = {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** aria label of the aside, e.g. "Week time breakdown" */
  readonly ariaLabel: string;
  /** subject used in the toggle button labels, e.g. "week breakdown" */
  readonly toggleSubject: string;
  readonly children: ReactNode;
};

/** Collapsible Breakdown side panel chrome shared by Your Day and Your Week.
 *  The open/closed layout swap (rail vs content) is CSS-driven off the
 *  `week-v2-grid--side-open` class on the surrounding grid. */
export function BreakdownSidePanel({ open, onToggle, ariaLabel, toggleSubject, children }: BreakdownSidePanelProps) {
  return (
    <aside className="week-v2-side" aria-label={ariaLabel}>
      <button type="button" className="week-v2-side__rail" onClick={onToggle} aria-label={`Show ${toggleSubject}`} aria-expanded={open}>
        <span className="week-v2-side__rail-arrow" aria-hidden="true">‹</span>
        <span className="week-v2-side__rail-label" aria-hidden="true">Breakdown</span>
      </button>
      <div className="week-v2-side__content">
        <button type="button" className="week-v2-side__head week-v2-side__headbtn" onClick={onToggle} aria-label={`Collapse ${toggleSubject}`} aria-expanded={open}>
          <span className="week-v2-side__collapse" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 3.5 8.5 8 4 12.5" />
              <path d="M8.5 3.5 13 8l-4.5 4.5" />
            </svg>
          </span>
          <strong className="week-v2-side__title">Breakdown</strong>
        </button>
        {children}
      </div>
    </aside>
  );
}

type BreakdownHeroCardProps = {
  readonly ariaLabel: string;
  readonly eyebrow: string;
  readonly value: string;
  readonly deltaPercent: number | null;
  readonly deltaComparisonLabel: string;
};

/** "Focus today / this week" hero card with the vs-previous-period badge. */
export function BreakdownHeroCard({ ariaLabel, eyebrow, value, deltaPercent, deltaComparisonLabel }: BreakdownHeroCardProps) {
  return (
    <section className="week-v2-side-card week-v2-side__hero" aria-label={ariaLabel}>
      <span className="label-mono">{eyebrow}</span>
      <div className="week-v2-side__hero-row">
        <strong className="week-v2-side__hero-value">{value}</strong>
      </div>
      {deltaPercent !== null ? (
        <p className="week-v2-side__hero-sub">
          <span className="week-v2-side__hero-badge">{deltaPercent >= 0 ? "↑" : "↓"} {Math.abs(deltaPercent)}%</span> {deltaComparisonLabel}
        </p>
      ) : null}
    </section>
  );
}
