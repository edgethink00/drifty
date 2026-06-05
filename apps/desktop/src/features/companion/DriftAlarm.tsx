import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

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

type DriftAlarmActionView = {
  label: string;
  action: DriftAlarmAction;
  tone?: "primary" | "quiet";
};

const DRIFT_ALARM_BREAK_OPTIONS = [5, 15, 30, 60] as const;
const DRIFT_ALARM_FOCUS_TARGET_LIMIT = 3;

const DRIFT_ALARM_SECONDARY_ACTIONS: DriftAlarmActionView[] = [
  { label: "Correct timeline", action: { type: "manual_correction" } },
  { label: "Alarm settings", action: { type: "settings" }, tone: "quiet" },
];

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
}: {
  event: DriftAlarmEvent | null;
  onAction: (action: DriftAlarmAction) => void;
}) {
  if (!event) return null;

  const heatSource = event.contextLabel || "This drift";
  const focusTargets = event.focusTargets.slice(0, DRIFT_ALARM_FOCUS_TARGET_LIMIT);

  return (
    <aside
      className="watcher-peek watcher-peek--drift-alarm watcher-peek--top-right"
      data-mood="drift"
      data-phase="speaking"
      data-presence="interrupting"
      aria-label="Drifty drift alarm"
      aria-live="assertive"
    >
      <div className="watcher-peek__stage">
        <div className="watcher-peek__orb" aria-hidden="true">
          <span className="watcher-peek__orb-shadow" />
          <span className="watcher-peek__orb-halo" />
          <span className="watcher-peek__orb-ring watcher-peek__orb-ring--outer" />
          <span className="watcher-peek__orb-ring watcher-peek__orb-ring--inner" />
          <span className="watcher-peek__orb-core">
            <span className="watcher-peek__orb-glow" />
            <span className="watcher-peek__orb-glint watcher-peek__orb-glint--one" />
            <span className="watcher-peek__orb-glint watcher-peek__orb-glint--two" />
          </span>
          <span className="watcher-peek__signal watcher-peek__signal--one" />
          <span className="watcher-peek__signal watcher-peek__signal--two" />
          <span className="watcher-peek__signal watcher-peek__signal--three" />
          <span className="watcher-peek__signal watcher-peek__signal--four" />
        </div>
        <section className="watcher-peek__card">
          <span className="watcher-peek__eyebrow">Ember check</span>
          <h2>Your {event.preservedFocusStrikeLabel} focus flame is still alive.</h2>
          <p>
            {heatSource} has been pulling heat for {event.driftDurationLabel}. Choose your next move before the streak cools.
          </p>
          <div className="watcher-peek__decision-grid">
            <section className="watcher-peek__choice-group" aria-labelledby="drift-alarm-focus-targets">
              <h3 id="drift-alarm-focus-targets">Return to a warm focus trail</h3>
              <div className="watcher-peek__target-list">
                {focusTargets.length > 0 ? focusTargets.map((target) => (
                  <button
                    className="watcher-peek__target-button watcher-peek__action--primary"
                    key={target.targetId}
                    type="button"
                    onClick={() => onAction({ type: "return_to_focus", targetId: target.targetId })}
                  >
                    <DriftAlarmFocusTargetIcon target={target} />
                    <span className="watcher-peek__target-copy">
                      <strong>{target.label}</strong>
                      <small>{target.detail}</small>
                    </span>
                  </button>
                )) : (
                  <div className="watcher-peek__target-empty">
                    <span>No recent focus destination yet.</span>
                    <button
                      className="watcher-peek__action watcher-peek__action--primary"
                      type="button"
                      onClick={() => onAction({ type: "return_to_focus", targetId: "dashboard" })}
                    >
                      Back to dashboard
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="watcher-peek__choice-group" aria-labelledby="drift-alarm-break-options">
              <h3 id="drift-alarm-break-options">Bank the ember break</h3>
              <div className="watcher-peek__break-options">
                {event.breakOptions.map((minutes) => (
                  <button
                    className="watcher-peek__action watcher-peek__break-option"
                    key={minutes}
                    type="button"
                    onClick={() => onAction({ type: "start_break", minutes })}
                  >
                    {formatBreakOption(minutes)}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="watcher-peek__actions watcher-peek__actions--secondary" aria-label="Secondary drift alarm actions">
            {DRIFT_ALARM_SECONDARY_ACTIONS.map((item) => (
              <button
                className={`watcher-peek__action${item.tone ? ` watcher-peek__action--${item.tone}` : ""}`}
                key={item.action.type}
                type="button"
                onClick={() => onAction(item.action)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function DriftAlarmFocusTargetIcon({ target }: { target: DriftAlarmFocusTarget }) {
  if (target.siteDomain) {
    return (
      <span className="watcher-peek__target-icon">
        <SiteFavicon domain={target.siteDomain} size={22} fallbackIconSrc={target.iconSrc} />
      </span>
    );
  }

  return (
    <span className="watcher-peek__target-icon">
      <AppGlyph appName={target.appName || target.label} iconSrc={target.iconSrc} size="sm" />
    </span>
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
