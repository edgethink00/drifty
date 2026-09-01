import type { ReactNode } from "react";

type BreakdownPanelChevronProps = {
  readonly direction: "left" | "right";
};

function BreakdownPanelChevron({ direction }: BreakdownPanelChevronProps) {
  return (
    <svg className="week-v2-side__chevron" data-direction={direction} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5 7 8 3 11.5" />
      <path d="M8.5 4.5 12.5 8 8.5 11.5" />
    </svg>
  );
}

type BreakdownSidePanelProps = {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** aria label of the aside, e.g. "Week time breakdown" */
  readonly ariaLabel: string;
  /** subject used in the toggle button labels, e.g. "week breakdown" */
  readonly toggleSubject: string;
  readonly title?: string;
  readonly showLabel?: string;
  readonly collapseLabel?: string;
  readonly children: ReactNode;
};

/** Collapsible Breakdown side panel chrome shared by Your Day and Your Week.
 *  The open/closed layout swap (rail vs content) is CSS-driven off the
 *  `week-v2-grid--side-open` class on the surrounding grid. */
export function BreakdownSidePanel({
  open,
  onToggle,
  ariaLabel,
  toggleSubject,
  title = "Breakdown",
  showLabel = `Show ${toggleSubject}`,
  collapseLabel = `Collapse ${toggleSubject}`,
  children,
}: BreakdownSidePanelProps) {
  return (
    <aside className="week-v2-side" aria-label={ariaLabel}>
      <button type="button" className="week-v2-side__rail" onClick={onToggle} aria-label={showLabel} aria-expanded={open}>
        <span className="week-v2-side__rail-arrow" aria-hidden="true"><BreakdownPanelChevron direction="left" /></span>
        <span className="week-v2-side__rail-label" aria-hidden="true">{title}</span>
      </button>
      <div className="week-v2-side__content">
        <button type="button" className="week-v2-side__head week-v2-side__headbtn" onClick={onToggle} aria-label={collapseLabel} aria-expanded={open}>
          <span className="week-v2-side__collapse" aria-hidden="true">
            <BreakdownPanelChevron direction="right" />
          </span>
          <strong className="week-v2-side__title">{title}</strong>
        </button>
        {children}
      </div>
    </aside>
  );
}
