import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import driftyWordmarkUrl from "../../assets/drifty-wordmark.png";

export type DriftAlarmAction =
  | { type: "return_to_focus"; targetId: string }
  | { type: "start_break"; minutes: number }
  | { type: "manual_correction" }
  | { type: "settings" };

export type DriftAlarmFocusTarget = {
  targetId: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  siteTitle: string | null;
  iconSrc: string | null;
};

export type DriftAlarmEvent = {
  id: string;
  contextLabel: string;
  driftDurationLabel: string;
  driftDurationSeconds: number;
  preservedFocusStrikeLabel: string;
  preservedFocusStrikeSeconds: number;
  generatedAt: string;
  breakOptions: number[];
  focusTargets: DriftAlarmFocusTarget[];
};

type DriftAlarmEventInput = {
  id: string;
  contextLabel: string;
  driftDurationSeconds: number;
  preservedFocusStrikeSeconds: number;
  generatedAt: string;
  breakOptions?: number[];
  focusTargets?: DriftAlarmFocusTarget[];
};

const DRIFT_ALARM_BREAK_OPTIONS = [5, 15, 30, 60] as const;
const DRIFT_ALARM_FOCUS_TARGET_LIMIT = 4;
const DRIFT_ALARM_TITLE_ID = "drift-alarm-title";
const DRIFT_ALARM_DESCRIPTION_ID = "drift-alarm-description";
const DRIFT_ALARM_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function buildDriftAlarmEvent(input: DriftAlarmEventInput): DriftAlarmEvent {
  return {
    ...input,
    driftDurationLabel: formatDuration(input.driftDurationSeconds),
    preservedFocusStrikeLabel: formatFocusStrike(input.preservedFocusStrikeSeconds),
    breakOptions: normalizeBreakOptions(input.breakOptions),
    focusTargets: normalizeFocusTargets(input.focusTargets),
  };
}

export function DriftAlarm({
  event,
  onAction,
  onCancel,
}: {
  event: DriftAlarmEvent | null;
  onAction: (action: DriftAlarmAction) => void;
  onCancel?: () => void;
}) {
  const alarmRef = useRef<HTMLElement | null>(null);
  const eventId = event?.id ?? null;
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
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
  }, [eventId]);

  useEffect(() => {
    setSelectedActionId(null);
    setIsDismissed(false);
  }, [eventId]);

  if (!event) return null;

  const heatSource = event.contextLabel || "This drift";
  const focusTargets = event.focusTargets.slice(0, DRIFT_ALARM_FOCUS_TARGET_LIMIT);
  const latestFocusTargetLabel = focusTargets[0]?.label ?? null;

  const selectAction = (actionId: string, action: DriftAlarmAction) => {
    setSelectedActionId(actionId);
    setIsDismissed(false);
    onAction(action);
  };

  const dismissAlarm = () => {
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
      className={`da${isDismissed ? " is-dismissed" : ""}`}
      ref={alarmRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={DRIFT_ALARM_TITLE_ID}
      aria-describedby={DRIFT_ALARM_DESCRIPTION_ID}
      aria-live="assertive"
      tabIndex={-1}
      onKeyDown={handleAlarmKeyDown}
    >
      <div className="da__topbar">
        <img className="window-logo" src={driftyWordmarkUrl} alt="Drifty" />
        <div className="da__chrome">
          <button className="icon-btn" type="button" aria-label="Alarm settings" onClick={() => selectAction("settings", { type: "settings" })}>
            <SettingsIcon />
          </button>
          <button className="icon-btn" type="button" aria-label="Dismiss drift alarm" onClick={dismissAlarm}>
            <DismissIcon />
          </button>
        </div>
      </div>

      <div className="da__hero">
        <div className="da__hero-copy">
          <h2 id={DRIFT_ALARM_TITLE_ID}>Drift detected</h2>
          <p className="da__drift" id={DRIFT_ALARM_DESCRIPTION_ID}>
            <span className="src-tile src-tile--drift" aria-hidden="true">
              <DriftSourceGlyph />
            </span>
            <span>{heatSource} · <strong>{event.driftDurationLabel} drift</strong></span>
          </p>
          <div className="da__context" aria-label="Drift context">
            <div className="da__context-pills">
              <span className="da__context-pill">Now <strong>{heatSource}</strong></span>
              {latestFocusTargetLabel ? (
                <span className="da__context-pill">Latest focus <strong>{latestFocusTargetLabel}</strong></span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="da__choices">
        <section className="da__choice" aria-labelledby="drift-alarm-focus-targets">
          <h3 className="overline da__choice-label" id="drift-alarm-focus-targets">Return to focus</h3>
          <div className="da__target-list">
            {focusTargets.length > 0 ? focusTargets.map((target, index) => (
              <button
                className={`da__target${index === 0 ? " da__target--primary" : ""}${selectedActionId === `target:${target.targetId}` ? " is-selected" : ""}`}
                key={target.targetId}
                type="button"
                onClick={() => selectAction(`target:${target.targetId}`, { type: "return_to_focus", targetId: target.targetId })}
                data-drift-alarm-initial-focus={index === 0 ? "true" : undefined}
              >
                <DriftAlarmFocusTargetIcon target={target} />
                <span className="da__target-copy">
                  <strong>{target.label}</strong>
                  <small>{target.detail}</small>
                </span>
                <span className="da__target-go" aria-hidden="true">
                  <ArrowRightIcon />
                </span>
              </button>
            )) : (
              <div className="da__target-empty">
                <span>No recent focus destination yet.</span>
                <button
                  className={`da__target da__target--primary${selectedActionId === "target:dashboard" ? " is-selected" : ""}`}
                  type="button"
                  onClick={() => selectAction("target:dashboard", { type: "return_to_focus", targetId: "dashboard" })}
                  data-drift-alarm-initial-focus="true"
                >
                  <span className="da__target-icon" aria-hidden="true"><span className="da__target-glyph">Dr</span></span>
                  <span className="da__target-copy"><strong>Back to dashboard</strong><small aria-hidden="true">Choose a focus destination</small></span>
                  <span className="da__target-go" aria-hidden="true"><ArrowRightIcon /></span>
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="da__choice da__choice--break" aria-labelledby="drift-alarm-break-options">
          <h3 className="overline da__choice-label" id="drift-alarm-break-options">Take a break</h3>
          <div className="da__breaks">
            {event.breakOptions.map((minutes, index) => (
              <button
                className={`da__break${selectedActionId === `break:${minutes}` ? " is-selected" : ""}`}
                key={minutes}
                type="button"
                onClick={() => selectAction(`break:${minutes}`, { type: "start_break", minutes })}
              >
                {index === 0 ? <BreakIcon /> : null}
                <span>{formatBreakOption(minutes)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button className={`da__correct${selectedActionId === "manual_correction" ? " is-selected" : ""}`} type="button" onClick={() => selectAction("manual_correction", { type: "manual_correction" })}>
        <FlagIcon />
        Not a drift
      </button>
    </aside>
  );
}


function getDriftAlarmFocusableElements(alarm: HTMLElement): HTMLElement[] {
  return Array.from(alarm.querySelectorAll<HTMLElement>(DRIFT_ALARM_FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}

function DriftAlarmFocusTargetIcon({ target }: { target: DriftAlarmFocusTarget }) {
  if (target.siteDomain) {
    return (
      <span className="da__target-icon">
        <SiteFavicon domain={target.siteDomain} size={22} fallbackIconSrc={target.iconSrc} />
      </span>
    );
  }

  return (
    <span className="da__target-icon">
      <AppGlyph appName={target.appName || target.label} iconSrc={target.iconSrc} size="sm" />
    </span>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" />
    </svg>
  );
}

function DismissIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

function DriftSourceGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 7.3v9.4l7.5-4.7z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function BreakIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8h10v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V8z" />
      <path d="M16 10h1.4a2.1 2.1 0 0 1 0 4.2H16" />
      <path d="M8 3.5v2M12 3.5v2M16 3.5v2" />
      <path d="M5 21h13" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 21V4M6 4h11l-2 3.4L17 11H6" />
    </svg>
  );
}

function normalizeBreakOptions(options: number[] | undefined): number[] {
  const source = options && options.length > 0 ? options : [...DRIFT_ALARM_BREAK_OPTIONS];
  const normalized = Array.from(new Set(source
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
    .map((minutes) => Math.min(minutes, 60))))
    .sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : [...DRIFT_ALARM_BREAK_OPTIONS];
}

function normalizeFocusTargets(targets: DriftAlarmFocusTarget[] | undefined): DriftAlarmFocusTarget[] {
  if (!targets) return [];
  return targets
    .filter((target) => target.targetId.trim().length > 0 && target.label.trim().length > 0)
    .slice(0, DRIFT_ALARM_FOCUS_TARGET_LIMIT);
}

function formatBreakOption(minutes: number): string {
  if (minutes === 60) return "1h";
  return `${minutes}m`;
}

function formatFocusStrike(seconds: number): string {
  if (seconds < 60) return `${seconds}-second`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}-minute`;
  if (minutes === 60) return "1-hour";
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}
