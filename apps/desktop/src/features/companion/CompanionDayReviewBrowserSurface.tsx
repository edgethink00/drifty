import { CompanionPillMoment } from "./CompanionPillMoment";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";

/**
 * Browser-only host for the current Companion Day Review.
 *
 * The native app hosts the same moment inside `CompanionPill`. Keeping this
 * shell deliberately small gives browser QA and Dev previews the production
 * renderer without reconnecting the retained legacy `Summary - Today` panel.
 */
export function CompanionDayReviewBrowserSurface({
  event,
  onDismiss,
  onOpenDashboard,
  onOpenAiSettings,
}: {
  event: EndOfDayReviewEvent;
  onDismiss: () => void;
  onOpenDashboard: () => void;
  onOpenAiSettings?: () => void;
}) {
  const layout = event.layout ?? "minimal";
  const pendingAssessment = event.assessment?.state === "pending";
  const cardState = pendingAssessment
    ? "eodPending"
    : layout === "full"
      ? "eod"
      : layout === "compact"
        ? "eodCompact"
        : "eodMinimal";

  return (
    <aside
      className="companion-day-review-browser-surface companion-pill-surface"
      data-layout={layout}
      data-assessment={pendingAssessment ? "pending" : undefined}
      data-preview="true"
      aria-label="Drifty end-of-day review"
      aria-live="polite"
    >
      <div
        className="pill"
        data-state="eod"
        data-card-state={cardState}
        data-eod-layout={layout === "full" ? "full" : "compact"}
        data-eod-version={layout}
        data-eod-assessment={pendingAssessment ? "pending" : undefined}
      >
        <div className="pill__clip">
          <CompanionPillMoment
            event={event}
            isActive
            autoDismissEnabled={false}
            onDismiss={onDismiss}
            onOpenDashboard={onOpenDashboard}
            onOpenAiSettings={onOpenAiSettings}
          />
        </div>
      </div>
    </aside>
  );
}
