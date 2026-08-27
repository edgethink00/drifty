import { CompanionPillMoment, type CompanionPillDriftEvent } from "./CompanionPillMoment";
import type { DriftAlarmAction, DriftAlarmEvent } from "./driftAlarmEvent";

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
      role={isPreview ? "group" : "alertdialog"}
      aria-label={isPreview ? `${moment.title} ${moment.summary}` : moment.title}
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
