import { CompanionPillMoment, type CompanionPillDriftEvent } from "./CompanionPillMoment";
import type { DriftAlarmAction, DriftAlarmEvent } from "./driftAlarmEvent";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";

export function toCompanionDriftAlarmMoment(alarm: DriftAlarmEvent): CompanionPillDriftEvent {
  const target = alarm.focusTargets[0] ?? null;
  return {
    kind: "driftAlarm",
    mode: alarm.mode,
    id: alarm.id,
    title: alarm.copy?.title ?? `${alarm.driftDurationLabel} off track.`,
    summary: alarm.copy?.summary ?? `${alarm.contextLabel} is outside your focus flow.`,
    returnLabel: target
      ? alarm.copy?.returnToFocusLabel ?? `Back to ${target.label}`
      : alarm.copy?.backToDashboardLabel ?? "Open dashboard",
    returnTargetId: target?.targetId ?? null,
    breakLabel: alarm.copy?.breakChoiceLabel ?? "Take a break",
    correctionLabel: alarm.copy?.manualCorrectionLabel ?? "Not a drift",
    correctionStatus: alarm.correctionStatus,
    generatedAt: alarm.generatedAt,
  };
}

/** Compact drift decision card shared by browser QA and the copy editor. */
export function CompanionDriftAlarmCard({
  event,
  isPreview = false,
  onAction,
  onDismiss,
  onOpenDashboard,
}: {
  readonly event: DriftAlarmEvent;
  readonly isPreview?: boolean;
  readonly onAction: (action: DriftAlarmAction) => void;
  readonly onDismiss: () => void;
  readonly onOpenDashboard: () => void;
}) {
  const moment = toCompanionDriftAlarmMoment(event);
  const previewInertProps = isPreview ? { inert: "" } : {};
  return (
    <div
      className={`companion-drift-alarm-card companion-pill-surface${isPreview ? " companion-drift-alarm-card--preview" : ""}`}
      data-state="drift"
      data-mode={moment.mode}
      data-preview={isPreview ? "true" : undefined}
      role={isPreview ? "group" : moment.correctionStatus ? undefined : "alertdialog"}
      aria-live={!isPreview && moment.correctionStatus ? "polite" : undefined}
      aria-label={isPreview
        ? `${moment.title} ${moment.summary}`
        : moment.correctionStatus ? undefined : moment.title}
    >
      <div
        className="pill"
        data-state="drift"
        data-card-state="drift"
        data-mood="drift"
        {...previewInertProps}
      >
        <div className="pill__clip">
          <CompanionPillMoment
            event={moment}
            autoDismissEnabled={!isPreview}
            onDismiss={onDismiss}
            onOpenDashboard={onOpenDashboard}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact Automatic close card shared by browser QA and the copy editor. */
export function CompanionAutomaticCloseCard({
  event,
  isPreview = false,
  onAction,
  onDismiss,
  onOpenDashboard,
}: {
  readonly event: ExtremeNudgeToastEvent;
  readonly isPreview?: boolean;
  readonly onAction: (action: DriftAlarmAction) => void;
  readonly onDismiss: () => void;
  readonly onOpenDashboard: () => void;
}) {
  const previewInertProps = isPreview ? { inert: "" } : {};
  const previewLabel = event.focusLabel ? `${event.title} Back in ${event.focusLabel}` : event.title;
  return (
    <div
      className={`companion-drift-alarm-card companion-pill-surface${isPreview ? " companion-drift-alarm-card--preview" : ""}`}
      data-state="nudge"
      data-preview={isPreview ? "true" : undefined}
      role={isPreview ? "group" : "alertdialog"}
      aria-label={isPreview ? previewLabel : event.title}
    >
      <div
        className="pill"
        data-state="nudge"
        data-card-state="nudge"
        {...previewInertProps}
      >
        <div className="pill__clip">
          <CompanionPillMoment
            event={event}
            autoDismissEnabled={!isPreview}
            onDismiss={onDismiss}
            onOpenDashboard={onOpenDashboard}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}
