export const WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT = 100;
export const WEEK_DASHBOARD_AXIS_SCALE_MIN_PERCENT = 75;
export const WEEK_DASHBOARD_AXIS_SCALE_MAX_PERCENT = 105;

const WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX = 56;

export function clampWeekDashboardAxisScalePercent(value: number): number {
  if (!Number.isFinite(value)) return WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
  return Math.min(
    WEEK_DASHBOARD_AXIS_SCALE_MAX_PERCENT,
    Math.max(WEEK_DASHBOARD_AXIS_SCALE_MIN_PERCENT, Math.round(value)),
  );
}

export function resolveEffectiveWeekDashboardAxisScalePercent(devModeActive: boolean, scalePercent: number): number {
  return devModeActive
    ? clampWeekDashboardAxisScalePercent(scalePercent)
    : WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
}

export function weekDashboardAxisScalePercentToHourHeight(scalePercent: number): number {
  return (WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX * clampWeekDashboardAxisScalePercent(scalePercent)) / 100;
}

export function formatWeekDashboardAxisPixelValue(value: number): string {
  if (Number.isInteger(value)) return `${value}px`;
  return `${Number(value.toFixed(4))}px`;
}
