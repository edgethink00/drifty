export const WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT = 75;

export const WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX = 56;

export function weekDashboardAxisScalePercentToHourHeight(scalePercent: number): number {
  const resolvedScalePercent = Number.isFinite(scalePercent)
    ? scalePercent
    : WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
  return (WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX * resolvedScalePercent) / 100;
}

export function formatWeekDashboardAxisPixelValue(value: number): string {
  if (Number.isInteger(value)) return `${value}px`;
  return `${Number(value.toFixed(4))}px`;
}
