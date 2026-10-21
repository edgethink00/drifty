import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useActivityInspection } from "./ActivityInspectionContext";
import { useBreakdownPanelTransition } from "./breakdownPanelTransition";
import { useLocalization } from "../localization/LocalizationContext";

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

/** One chevron in the double chevron's box, so the head keeps its position. */
function BreakdownBackChevron() {
  return (
    <svg className="week-v2-side__chevron" data-direction="back" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 4 6 8l4 4" />
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
  const inspection = useActivityInspection();
  const { t } = useLocalization();
  const asideRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const summaryScroll = useRef(0);
  const wasActive = useRef(false);
  const active = inspection.presentation === "panel" && inspection.panelActive;
  useBreakdownPanelTransition(asideRef, contentRef, inspection.presentation === "panel");
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || wasActive.current === active) return;
    if (active) content.scrollTop = 0;
    else content.scrollTop = summaryScroll.current;
    wasActive.current = active;
  }, [active]);
  const toggle = () => { if (active) inspection.dismissSelection(); onToggle(); };
  // With an activity open, the head becomes the way back to this summary,
  // in the collapse control's own place.
  const backInHead = active;
  return (
    <aside
      ref={asideRef}
      className="week-v2-side"
      aria-label={ariaLabel}
      data-detail-footer={active || undefined}
    >
      <button type="button" className="week-v2-side__rail" onClick={toggle} aria-label={showLabel} aria-expanded={open}>
        <span className="week-v2-side__rail-arrow" aria-hidden="true"><BreakdownPanelChevron direction="left" /></span>
        <span className="week-v2-side__rail-label" aria-hidden="true">{title}</span>
      </button>
      <div className="week-v2-side__content" ref={contentRef} onScroll={() => { if (!active && contentRef.current) summaryScroll.current = contentRef.current.scrollTop; }} data-detail-active={active || undefined} data-detail-actions={active ? "footer" : undefined}>
        <button
          type="button"
          className="week-v2-side__head week-v2-side__headbtn"
          onClick={backInHead ? inspection.dismissSelection : toggle}
          aria-label={backInHead ? t("dashboard.activityDetail.backToBreakdown") : collapseLabel}
          aria-expanded={backInHead ? undefined : open}
          data-back={backInHead || undefined}
        >
          <span className="week-v2-side__collapse" aria-hidden="true">
            {backInHead ? <BreakdownBackChevron /> : <BreakdownPanelChevron direction="right" />}
          </span>
          <strong className="week-v2-side__title">{title}</strong>
        </button>
        <div className="activity-detail-slot" ref={inspection.registerPanel} hidden={!active} />
        {children}
      </div>
    </aside>
  );
}
