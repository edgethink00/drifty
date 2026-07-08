import { WeekDashboardAxisScaleControl } from "./WeekDashboardAxisScaleControl";

type DevSettingsDashboardLayoutBlockProps = {
  readonly weekDashboardAxisScalePercent: number;
  readonly onResetWeekDashboardAxisScalePercent: () => void;
  readonly onWeekDashboardAxisScalePercentChange: (scalePercent: number) => void;
};

export function DevSettingsDashboardLayoutBlock({
  weekDashboardAxisScalePercent,
  onResetWeekDashboardAxisScalePercent,
  onWeekDashboardAxisScalePercentChange,
}: DevSettingsDashboardLayoutBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Dashboard layout</h3>
      <div className="settings-row settings-row--fallback settings-row--week-axis-scale">
        <div>
          <div className="lbl">Your Week y-axis scale</div>
          <div className="desc">Adjust the Week calendar vertical hour scale for layout review.</div>
        </div>
        <div className="ctrl settings-row__actions">
          <WeekDashboardAxisScaleControl
            scalePercent={weekDashboardAxisScalePercent}
            onResetScalePercent={onResetWeekDashboardAxisScalePercent}
            onScalePercentChange={onWeekDashboardAxisScalePercentChange}
          />
        </div>
      </div>
    </div>
  );
}
