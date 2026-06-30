import type { ChangeEvent, RefObject } from "react";
import { Toggle } from "../../components/Toggle";
import {
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED,
  REPLAY_ONBOARDING_DEV_TOOL_ENABLED,
} from "../../appFeatureSwitches";
import { DRIFT_ALARM_PREVIEW_OPTIONS } from "../companion/driftAlarmData";
import {
  DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES,
  WATCHER_PERIODIC_MAX_LIMIT_MINUTES,
  WATCHER_PERIODIC_MIN_LIMIT_MINUTES,
  type WatcherMode,
} from "../companion/watcherData";
import { DeveloperPreReleaseUpdateRow } from "../updates/DeveloperPreReleaseUpdateRow";

export type DriftAlarmPreviewOption = typeof DRIFT_ALARM_PREVIEW_OPTIONS[number];

type DevPreviewControlsProps = {
  readonly endOfDayReviewSettingsRowRef: RefObject<HTMLDivElement>;
  readonly showWatcherPeekSettings: boolean;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
  readonly onEndOfDayReviewPreview: () => void;
  readonly onOpenReplayOnboarding: () => void;
  readonly onPreviewDriftAlarm: (option: DriftAlarmPreviewOption) => void;
  readonly onShowWatcherPeek: (force?: boolean) => void;
  readonly onWatcherModeChange: (mode: WatcherMode) => void;
  readonly onWatcherPeekEnabledChange: (enabled: boolean) => void;
  readonly onWatcherPeriodicMaxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onWatcherPeriodicMinChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function DevPreviewControls({
  endOfDayReviewSettingsRowRef,
  showWatcherPeekSettings,
  watcherMode,
  watcherPeekEnabled,
  watcherPeriodicMaxMinutes,
  watcherPeriodicMinMinutes,
  onEndOfDayReviewPreview,
  onOpenReplayOnboarding,
  onPreviewDriftAlarm,
  onShowWatcherPeek,
  onWatcherModeChange,
  onWatcherPeekEnabledChange,
  onWatcherPeriodicMaxChange,
  onWatcherPeriodicMinChange,
}: DevPreviewControlsProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Dev</h3>
      {DEVELOPER_PRE_RELEASE_UPDATES_ENABLED ? <DeveloperPreReleaseUpdateRow /> : null}
      {REPLAY_ONBOARDING_DEV_TOOL_ENABLED ? (
        <div className="settings-row">
          <div>
            <div className="lbl">Replay onboarding</div>
            <div className="desc">Open the setup flow again without clearing saved onboarding state.</div>
          </div>
          <div className="ctrl">
            <button type="button" className="settings-btn" onClick={onOpenReplayOnboarding}>Open onboarding</button>
          </div>
        </div>
      ) : null}
      {END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED ? (
        <div className="settings-row" role="group" aria-label="End-of-day review" ref={endOfDayReviewSettingsRowRef} tabIndex={-1}>
          <div>
            <div className="lbl">End-of-day review</div>
            <div className="desc">Dev-only local summary after 6:00 PM, or preview it now.</div>
          </div>
          <div className="ctrl"><button type="button" className="settings-btn" onClick={onEndOfDayReviewPreview}>Preview</button></div>
        </div>
      ) : null}
      {DRIFT_ALARM_PANEL_PREVIEWS_ENABLED ? (
        <div className="settings-row">
          <div>
            <div className="lbl">Drift alarm previews</div>
            <div className="desc">Open sample alarm panels without waiting for tracker drift. Dev builds only.</div>
          </div>
          <div className="ctrl settings-row__actions">
            {DRIFT_ALARM_PREVIEW_OPTIONS.map((option) => (
              <button key={option.id} type="button" className="settings-btn" onClick={() => onPreviewDriftAlarm(option)}>{option.label}</button>
            ))}
          </div>
        </div>
      ) : null}
      {showWatcherPeekSettings ? (
        <>
          <div className="settings-row" role="group" aria-label="Peek watcher prototype">
            <div>
              <div className="lbl">Peek watcher prototype</div>
              <div className="desc">Opt-in experiment for a quiet watcher overlay. Choose a regular cadence or drift-only nudges.</div>
            </div>
            <div className="ctrl settings-row__actions">
              <button type="button" className="settings-btn" onClick={() => onShowWatcherPeek(true)}>Preview</button>
              <Toggle checked={watcherPeekEnabled} onChange={onWatcherPeekEnabledChange} ariaLabel="Toggle peek watcher prototype" />
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="lbl">Watcher mode</div>
              <div className="desc">Choose regular check-ins or a quieter mode that only speaks when drift continues.</div>
            </div>
            <div className="ctrl">
              <div className="settings-mode-switch" role="radiogroup" aria-label="Watcher mode">
                <button type="button" className={`settings-mode-option${watcherMode === "periodic" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "periodic"} onClick={() => onWatcherModeChange("periodic")}>
                  <span>Periodic</span>
                  <small>Every few minutes</small>
                </button>
                <button type="button" className={`settings-mode-option${watcherMode === "drift_only" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "drift_only"} onClick={() => onWatcherModeChange("drift_only")}>
                  <span>Drift only</span>
                  <small>Quiet during focus</small>
                </button>
              </div>
            </div>
          </div>
          {watcherMode === "periodic" ? (
            <div className="settings-row">
              <div>
                <div className="lbl">Periodic cadence</div>
                <div className="desc">Show the watcher at a random interval inside this range. Default is {DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.min}-{DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.max} minutes.</div>
              </div>
              <div className="ctrl settings-row__actions">
                <input className="settings-input settings-input--compact" type="number" min={WATCHER_PERIODIC_MIN_LIMIT_MINUTES} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMinMinutes} onChange={onWatcherPeriodicMinChange} aria-label="Minimum watcher interval minutes" />
                <span className="settings-inline-unit">to</span>
                <input className="settings-input settings-input--compact" type="number" min={watcherPeriodicMinMinutes} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMaxMinutes} onChange={onWatcherPeriodicMaxChange} aria-label="Maximum watcher interval minutes" />
                <span className="settings-inline-unit">min</span>
              </div>
            </div>
          ) : (
            <div className="settings-row">
              <div>
                <div className="lbl">Drift-only cadence</div>
                <div className="desc">No focus messages. First nudge appears 10 seconds after drift is detected, then 5 minutes, 30 minutes, 1 hour, and 2 hours if it continues.</div>
              </div>
              <div className="ctrl"><span className="chip">10s · 5m · 30m · 1h · 2h</span></div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
