import { FLOW_INTERVAL_OPTIONS, type FlowIntervalMinutes } from "@drifty/domain";

export type DashboardFlowIntervalMinutes = FlowIntervalMinutes;

/** Timeline density, shared by every surface drawn on the Flow grid (Your Day
 *  and Your Agents today). The value is one thing — how many minutes one grid
 *  cell covers — and both surfaces derive cell height from it with the same
 *  constants, so a per-surface preference would make the same control mean the
 *  same thing while remembering two answers. The key keeps its `dashboard`
 *  name so an existing user's saved choice survives; renaming it would silently
 *  reset everyone back to the default. */
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
