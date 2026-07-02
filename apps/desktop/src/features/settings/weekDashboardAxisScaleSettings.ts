import {
  WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT,
  clampWeekDashboardAxisScalePercent,
  resolveEffectiveWeekDashboardAxisScalePercent,
} from "../dashboard/weekDashboardAxisScale";

export {
  WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT,
  WEEK_DASHBOARD_AXIS_SCALE_MAX_PERCENT,
  WEEK_DASHBOARD_AXIS_SCALE_MIN_PERCENT,
  clampWeekDashboardAxisScalePercent,
  resolveEffectiveWeekDashboardAxisScalePercent,
} from "../dashboard/weekDashboardAxisScale";

export const WEEK_DASHBOARD_AXIS_SCALE_STORAGE_KEY = "drifty.dev.weekDashboardAxisScalePercent";

function parseWeekDashboardAxisScalePercent(value: string | null): number {
  if (!value) return WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue)
    ? parsedValue
    : WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
}

export function resolveInitialWeekDashboardAxisScalePercent(): number {
  if (typeof window === "undefined") return WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
  return clampWeekDashboardAxisScalePercent(
    parseWeekDashboardAxisScalePercent(window.localStorage.getItem(WEEK_DASHBOARD_AXIS_SCALE_STORAGE_KEY)),
  );
}

export function persistWeekDashboardAxisScalePercent(value: number): number {
  const scalePercent = clampWeekDashboardAxisScalePercent(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WEEK_DASHBOARD_AXIS_SCALE_STORAGE_KEY, String(scalePercent));
  }
  return scalePercent;
}

export function resetWeekDashboardAxisScalePercent(): number {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(WEEK_DASHBOARD_AXIS_SCALE_STORAGE_KEY);
  }
  return WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
}
