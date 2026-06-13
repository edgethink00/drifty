import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import driftyWordmarkUrl from "../../assets/drifty-wordmark.png";
import { BreakDurationPicker } from "./BreakDurationPicker";
import { DismissIcon, DriftSourceGlyph, FlagIcon, SettingsIcon } from "./DriftAlarmIcons";
import { DriftAlarmFocusTargetList } from "./DriftAlarmFocusTargets";
import { buildDefaultDriftAlarmCopy, buildDriftAlarmCopy, type DriftAlarmRenderedCopy } from "./driftAlarmCopy";
import { DRIFT_ALARM_FOCUS_TARGET_LIMIT, type DriftAlarmAction, type DriftAlarmEvent, type DriftAlarmFocusTarget } from "./driftAlarmEvent";
import { renderBreakReturnSummary, renderBreakReturnTitle, renderContextPill } from "./driftAlarmRendering";
import { useDelayedDriftAlarmAction } from "./useDelayedDriftAlarmAction";

export { buildBreakReturnAlarmEvent, buildDriftAlarmEvent, formatBreakOption } from "./driftAlarmEvent";
export type { DriftAlarmAction, DriftAlarmBreakReturnDetails, DriftAlarmEvent, DriftAlarmFocusTarget } from "./driftAlarmEvent";

const DRIFT_ALARM_TITLE_ID = "drift-alarm-title";
const DRIFT_ALARM_DESCRIPTION_ID = "drift-alarm-description";
const TARGET_ACTION_ID_PREFIX = "target:";
const BREAK_ACTION_ID_PREFIX = "break:";
const DRIFT_ALARM_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function DriftAlarm({
  event,
  onAction,
  onCancel,
  isPreview = false,
}: {
  event: DriftAlarmEvent | null;
  onAction: (action: DriftAlarmAction) => void;
  onCancel?: () => void;
  isPreview?: boolean;
}) {
  const alarmRef = useRef<HTMLElement | null>(null);
  const eventId = event?.id ?? null;
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const { clearPendingBreakAction, isBreakActionPending, runDriftAlarmAction } = useDelayedDriftAlarmAction(onAction, isPreview);

  useEffect(() => {
    if (isPreview) return undefined;
    if (!eventId) return undefined;

    const alarm = alarmRef.current;
    if (!alarm) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement && !alarm.contains(document.activeElement)
      ? document.activeElement
      : null;
    const initialFocusTarget = alarm.querySelector<HTMLElement>("[data-drift-alarm-initial-focus]")
      ?? getDriftAlarmFocusableElements(alarm)[0]
      ?? alarm;
    const focusTimer = window.setTimeout(() => {
      if (document.contains(alarm)) initialFocusTarget.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
  }, [eventId, isPreview]);

  useEffect(() => {
    setSelectedActionId(null);
    setIsDismissed(false);
    clearPendingBreakAction();
  }, [clearPendingBreakAction, eventId]);

  if (!event) return null;

  const isBreakReturn = event.mode === "break_return";
  const focusTargets = event.focusTargets.slice(0, DRIFT_ALARM_FOCUS_TARGET_LIMIT);
  const breakReturn = event.breakReturn;
  const copy = event.copy ?? buildFallbackDriftAlarmCopy(event, focusTargets);
  const driftContextLabel = event.contextLabel.trim() || "This drift";
  const titleId = isPreview ? `${event.id}-title` : isBreakReturn ? "break-return-alarm-title" : DRIFT_ALARM_TITLE_ID;
  const descriptionId = isPreview ? `${event.id}-description` : isBreakReturn ? "break-return-alarm-description" : DRIFT_ALARM_DESCRIPTION_ID;
  const selectedTargetId = getSelectedTargetId(selectedActionId);
  const selectedBreakMinutes = getSelectedBreakMinutes(selectedActionId);

  const selectAction = (actionId: string, action: DriftAlarmAction) => {
    if (isBreakActionPending) return;
    setSelectedActionId(actionId);
    setIsDismissed(false);
    runDriftAlarmAction(action);
  };

  const dismissAlarm = () => {
    clearPendingBreakAction();
    setSelectedActionId(null);
    setIsDismissed(true);
    onCancel?.();
  };

  const handleAlarmKeyDown = (keyboardEvent: KeyboardEvent<HTMLElement>) => {
    if (keyboardEvent.key === "Escape") {
      if (onCancel) {
        keyboardEvent.preventDefault();
        dismissAlarm();
      }
      return;
    }

    if (keyboardEvent.key !== "Tab") return;

    const alarm = alarmRef.current;
    if (!alarm) return;

    const focusableElements = getDriftAlarmFocusableElements(alarm);
    if (focusableElements.length === 0) {
      keyboardEvent.preventDefault();
      alarm.focus({ preventScroll: true });
      return;
    }

    const activeElement = document.activeElement;
    const activeIndex = activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (keyboardEvent.shiftKey) {
      if (activeIndex <= 0) {
        keyboardEvent.preventDefault();
        lastFocusable.focus({ preventScroll: true });
      }
      return;
    }

    if (activeIndex === -1 || activeIndex === focusableElements.length - 1) {
      keyboardEvent.preventDefault();
      firstFocusable.focus({ preventScroll: true });
    }
  };

  return (
    <aside
      className={`da${isBreakReturn ? " da--return" : ""}${isPreview ? " da--preview" : ""}${isDismissed ? " is-dismissed" : ""}`}
      ref={alarmRef}
      role={isPreview ? "group" : "alertdialog"}
      aria-modal={isPreview ? undefined : "true"}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-live={isPreview ? undefined : isBreakReturn ? "polite" : "assertive"}
      tabIndex={isPreview ? undefined : -1}
      onKeyDown={handleAlarmKeyDown}
    >
      <div className="da__topbar">
        <img className="window-logo" src={driftyWordmarkUrl} alt="Drifty" />
        <div className="da__chrome">
          <button className="icon-btn" type="button" aria-label="Alarm settings" onClick={() => selectAction("settings", { type: "settings" })}>
            <SettingsIcon />
          </button>
          <button className="icon-btn" type="button" aria-label={isBreakReturn ? "Dismiss break return alarm" : "Dismiss drift alarm"} onClick={dismissAlarm}>
            <DismissIcon />
          </button>
        </div>
      </div>

      <div className="da__hero">
        <div className="da__hero-copy">
          {isBreakReturn && breakReturn ? (
            <h2 className="da__hero-title" id={titleId}>{breakReturn ? renderBreakReturnTitle(copy.title, breakReturn.breakDurationLabel) : copy.title}</h2>
          ) : (
            <h2 id={titleId}>{copy.title}</h2>
          )}
          <p className="da__drift" id={descriptionId}>
            {isBreakReturn && breakReturn ? (
              <>
                <span className="src-tile" aria-hidden="true">
                  <span className="da__target-glyph">{breakReturn.breakDurationMinutes}</span>
                </span>
                <span>{renderBreakReturnSummary(copy.summary, breakReturn.breakDurationLabel)}</span>
              </>
            ) : (
              <>
                <span className="src-tile src-tile--drift" aria-hidden="true">
                  <DriftSourceGlyph />
                </span>
                <span className="da__drift-copy">
                  <strong>{driftContextLabel}</strong>
                  <small>(now drifting)</small>
                </span>
              </>
            )}
          </p>
          {isBreakReturn && breakReturn ? (
            <div className="da__context" aria-label="Break return context">
              <div className="da__context-pills">
                {copy.contextPills.map((pill, index) => (
                  <span className="da__context-pill" key={pill}>
                    {renderContextPill(pill, [breakReturn.pausedFromLabel, breakReturn.nextFocusLabel][index] ?? null)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="da__choices">
        <section className="da__choice" aria-labelledby="drift-alarm-focus-targets">
          <h3 className="overline da__choice-label" id="drift-alarm-focus-targets">{copy.returnToFocusLabel}</h3>
          <div className="da__target-list">
            <DriftAlarmFocusTargetList
              backToDashboardLabel={copy.backToDashboardLabel}
              focusTargets={focusTargets}
              noFocusTargetLabel={copy.noFocusTargetLabel}
              selectedTargetId={selectedTargetId}
              onSelectTarget={(targetId) => selectAction(`${TARGET_ACTION_ID_PREFIX}${targetId}`, { type: "return_to_focus", targetId })}
            />
          </div>
        </section>

        <section className="da__choice da__choice--break" aria-labelledby="drift-alarm-break-options">
          <h3 className="overline da__choice-label" id="drift-alarm-break-options">{copy.breakChoiceLabel}</h3>
          <BreakDurationPicker
            isPending={isBreakActionPending}
            label={copy.breakChoiceLabel}
            options={event.breakOptions}
            selectedMinutes={selectedBreakMinutes}
            onSelect={(minutes) => selectAction(`${BREAK_ACTION_ID_PREFIX}${minutes}`, { type: "start_break", minutes })}
          />
        </section>
      </div>

      <button className={`da__correct${selectedActionId === "manual_correction" ? " is-selected" : ""}`} type="button" onClick={() => selectAction("manual_correction", { type: "manual_correction" })}>
        <FlagIcon />
        {copy.manualCorrectionLabel}
      </button>
    </aside>
  );
}


function getDriftAlarmFocusableElements(alarm: HTMLElement): HTMLElement[] {
  return Array.from(alarm.querySelectorAll<HTMLElement>(DRIFT_ALARM_FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}

function getSelectedTargetId(actionId: string | null): string | null {
  if (!actionId?.startsWith(TARGET_ACTION_ID_PREFIX)) return null;
  return actionId.slice(TARGET_ACTION_ID_PREFIX.length);
}

function getSelectedBreakMinutes(actionId: string | null): number | null {
  if (!actionId?.startsWith(BREAK_ACTION_ID_PREFIX)) return null;
  const minutes = Number(actionId.slice(BREAK_ACTION_ID_PREFIX.length));
  return Number.isInteger(minutes) ? minutes : null;
}

function buildFallbackDriftAlarmCopy(event: DriftAlarmEvent, focusTargets: readonly DriftAlarmFocusTarget[]): DriftAlarmRenderedCopy {
  const defaultCopy = buildDefaultDriftAlarmCopy();
  switch (event.mode) {
    case "drift":
      return buildDriftAlarmCopy(defaultCopy, {
        mode: "drift",
        contextLabel: event.contextLabel,
        driftDurationLabel: event.driftDurationLabel,
        latestFocusLabel: focusTargets[0]?.label ?? null,
      });
    case "break_return":
      return buildDriftAlarmCopy(defaultCopy, {
        mode: "break_return",
        breakDurationLabel: event.breakReturn.breakDurationLabel,
        pausedFromLabel: event.breakReturn.pausedFromLabel,
        nextFocusLabel: event.breakReturn.nextFocusLabel,
      });
    default:
      return assertNeverDriftAlarmEvent(event);
  }
}

function assertNeverDriftAlarmEvent(value: never): never {
  throw new Error(`Unexpected drift alarm event: ${JSON.stringify(value)}`);
}
