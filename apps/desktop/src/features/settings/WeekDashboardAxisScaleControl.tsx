import {
  WEEK_DASHBOARD_AXIS_SCALE_CONTROL_MAX_PERCENT,
  WEEK_DASHBOARD_AXIS_SCALE_CONTROL_MIN_PERCENT,
  WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT,
  weekDashboardAxisScaleControlPercentToAxisScalePercent,
  weekDashboardAxisScalePercentToControlPercent,
} from "./settingsStorage";

type WeekDashboardAxisScaleControlProps = {
  readonly scalePercent: number;
  readonly onScalePercentChange: (scalePercent: number) => void;
  readonly onResetScalePercent: () => void;
};

export function WeekDashboardAxisScaleControl({
  scalePercent,
  onScalePercentChange,
  onResetScalePercent,
}: WeekDashboardAxisScaleControlProps) {
  const controlScalePercent = weekDashboardAxisScalePercentToControlPercent(scalePercent);

  return (
    <div className="settings-axis-scale-control">
      <span className="settings-axis-scale-control__value" aria-label="Current Your Week y-axis scale">
        {controlScalePercent}%
      </span>
      <input
        aria-label="Your Week y-axis scale percent"
        className="settings-range"
        max={WEEK_DASHBOARD_AXIS_SCALE_CONTROL_MAX_PERCENT}
        min={WEEK_DASHBOARD_AXIS_SCALE_CONTROL_MIN_PERCENT}
        step={1}
        type="range"
        value={controlScalePercent}
        onChange={(event) => onScalePercentChange(
          weekDashboardAxisScaleControlPercentToAxisScalePercent(Number(event.target.value)),
        )}
      />
      <button
        className="settings-btn"
        disabled={scalePercent === WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT}
        type="button"
        onClick={onResetScalePercent}
      >
        Reset
      </button>
    </div>
  );
}
