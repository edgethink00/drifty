import { FLOW_INTERVAL_OPTIONS, type FlowIntervalMinutes } from "@drifty/domain";

export type DashboardFlowIntervalMinutes = FlowIntervalMinutes;

export const DASHBOARD_FLOW_INTERVAL_STORAGE_KEY = "drifty.dashboard.flowIntervalMinutes.v1";
export const DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES: DashboardFlowIntervalMinutes = 4;
/** Fixed aggregation detail for Share rhythm and Breakdown identity rows. */
export const DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES: DashboardFlowIntervalMinutes = 5;

export function normalizeDashboardFlowIntervalMinutes(
  value: FlowIntervalMinutes | string | null | undefined,
): DashboardFlowIntervalMinutes {
  const parsedValue = Number(value);
  return isFlowIntervalMinutes(parsedValue)
    ? parsedValue
    : DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES;
}

function isFlowIntervalMinutes(value: number): value is FlowIntervalMinutes {
  return FLOW_INTERVAL_OPTIONS.some((option) => option === value);
}

export function resolveInitialDashboardFlowIntervalMinutes(): DashboardFlowIntervalMinutes {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES;
  try {
    return normalizeDashboardFlowIntervalMinutes(window.localStorage.getItem(DASHBOARD_FLOW_INTERVAL_STORAGE_KEY));
  } catch {
    return DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES;
  }
}

export function persistDashboardFlowIntervalMinutes(
  intervalMinutes: FlowIntervalMinutes,
): DashboardFlowIntervalMinutes {
  const normalizedInterval = normalizeDashboardFlowIntervalMinutes(intervalMinutes);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DASHBOARD_FLOW_INTERVAL_STORAGE_KEY, String(normalizedInterval));
    } catch {
      // Storage is best-effort. The normalized value still updates this session.
    }
  }
  return normalizedInterval;
}
