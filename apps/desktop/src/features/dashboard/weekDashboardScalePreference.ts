import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT } from "./weekDashboardAxisScale";

export const WEEK_TIME_SCALE_OPTIONS = [75, 100, 125] as const;
export type WeekTimeScale = typeof WEEK_TIME_SCALE_OPTIONS[number];
export const WEEK_TIME_SCALE_STORAGE_KEY = "drifty.dashboard.weekTimeScale.v1";

export function normalizeWeekTimeScale(value: unknown): WeekTimeScale {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return WEEK_TIME_SCALE_OPTIONS.find(scale => scale === parsed) ?? WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
}

export function initialWeekTimeScale(): WeekTimeScale {
  try {
    return normalizeWeekTimeScale(window.localStorage.getItem(WEEK_TIME_SCALE_STORAGE_KEY));
  } catch {
    return WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT;
  }
}

export function persistWeekTimeScale(value: WeekTimeScale): WeekTimeScale {
  const scale = normalizeWeekTimeScale(value);
  try {
    window.localStorage.setItem(WEEK_TIME_SCALE_STORAGE_KEY, String(scale));
  } catch {
    // Keep the live choice when preference storage is unavailable.
  }
  return scale;
}
