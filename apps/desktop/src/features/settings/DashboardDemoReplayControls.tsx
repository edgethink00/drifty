import {
  DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
  type DemoDashboardReplaySettings,
} from "./settingsStorage";

export type DemoDashboardReplayKind = "day" | "week";

type DashboardDemoReplayControlsProps = {
  readonly settings?: DemoDashboardReplaySettings;
  readonly onDurationSecondsChange?: (value: number) => void;
  readonly onPreRollSecondsChange?: (value: number) => void;
  readonly onReplay?: (kind: DemoDashboardReplayKind) => void;
  readonly onReset?: () => void;
};

export function DashboardDemoReplayControls({
  settings,
  onDurationSecondsChange,
  onPreRollSecondsChange,
  onReplay,
  onReset,
}: DashboardDemoReplayControlsProps) {
  const controlsReady =
    Boolean(settings) && Boolean(onDurationSecondsChange) && Boolean(onPreRollSecondsChange) && Boolean(onReplay) && Boolean(onReset);
  const dashboardReplaySettings = settings ?? {
    preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
    durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
  };

  return (
    <div className="settings-row" role="group" aria-label="Dashboard demo replay">
      <div>
        <div className="lbl">Dashboard demo replay</div>
        <div className="desc">Replay the selected dashboard day or week for recording.</div>
      </div>
      <div className="ctrl settings-row__actions">
        <button type="button" className="settings-btn" disabled={!controlsReady} onClick={() => onReplay?.("day")}>Replay Your Day</button>
        <button type="button" className="settings-btn" disabled={!controlsReady} onClick={() => onReplay?.("week")}>Replay Your Week</button>
        <input
          className="settings-input settings-input--compact"
          type="number"
          value={dashboardReplaySettings.preRollSeconds}
          min={DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS}
          max={DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS}
          step={1}
          disabled={!controlsReady}
          onChange={(event) => onPreRollSecondsChange?.(Number(event.currentTarget.value))}
          aria-label="Demo replay pre-roll seconds"
        />
        <input
          className="settings-input settings-input--compact"
          type="number"
          value={dashboardReplaySettings.durationSeconds}
          min={DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS}
          max={DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS}
          step={1}
          disabled={!controlsReady}
          onChange={(event) => onDurationSecondsChange?.(Number(event.currentTarget.value))}
          aria-label="Demo replay duration seconds"
        />
        <button type="button" className="settings-btn" disabled={!controlsReady} onClick={onReset}>Reset defaults</button>
      </div>
    </div>
  );
}
