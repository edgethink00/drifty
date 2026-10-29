import { useCallback, useEffect, useState } from "react";

/**
 * Your Day and Your Week open hours down for everyone (product decision 2026-10-25). After an
 * outside poll favoured the earlier screen, the owner added a way back (2026-10-29): Settings ›
 * General › Appearance can show both as in 1.15. Day then runs its hours across with the
 * focus/drift score and app usage below the chart and opens an activity in its floating card; Week
 * has no time zoom and opens its floating card too. The choice belongs to this device and follows
 * other app windows. Whether to keep the option is reviewed around 2026-11-26 from how many people
 * use it, so the earlier layout gets fixes but no new features.
 */
export type DashboardLayout = "hoursDown" | "previous";

export const DASHBOARD_LAYOUT_STORAGE_KEY = "drifty.dashboardLayout.v1";

const STORED_VALUES: Readonly<Record<DashboardLayout, string>> = { hoursDown: "hours-down", previous: "previous" };

/** Anything other than an explicit "previous", including the retired Dev preview key, is hours down. */
export function readDashboardLayoutPreference(): DashboardLayout {
  try {
    return window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) === STORED_VALUES.previous ? "previous" : "hoursDown";
  } catch {
    return "hoursDown";
  }
}

export function useDashboardLayoutPreference(): readonly [DashboardLayout, (layout: DashboardLayout) => void] {
  const [layout, setLayoutState] = useState(readDashboardLayoutPreference);
  const setLayout = useCallback((next: DashboardLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, STORED_VALUES[next]);
    } catch {
      // Keep the live choice without storage.
    }
  }, []);
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== DASHBOARD_LAYOUT_STORAGE_KEY && event.key !== null) return;
      setLayoutState(readDashboardLayoutPreference());
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);
  return [layout, setLayout] as const;
}
