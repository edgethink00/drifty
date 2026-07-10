import { shiftIsoDate } from "@drifty/domain";

import { type TeamPeriod } from "./teamService";

export type TeamFocusWindow = {
  readonly period: TeamPeriod;
  readonly window_start_date: string;
  readonly window_end_date: string;
};

export function getTeamFocusWindow(period: TeamPeriod | string | null | undefined, windowEndDay: string): TeamFocusWindow | null {
  const parsedPeriod = parseTeamPeriod(period);
  if (!parsedPeriod) return null;

  switch (parsedPeriod) {
    case "daily":
      return { period: parsedPeriod, window_start_date: windowEndDay, window_end_date: windowEndDay };
    case "weekly":
      return { period: parsedPeriod, window_start_date: shiftIsoDate(windowEndDay, -6), window_end_date: windowEndDay };
    case "monthly":
      return { period: parsedPeriod, window_start_date: shiftIsoDate(windowEndDay, -29), window_end_date: windowEndDay };
    default:
      return assertNever(parsedPeriod);
  }
}

export function parseTeamPeriod(period: TeamPeriod | string | null | undefined): TeamPeriod | null {
  switch (period) {
    case "daily":
    case "weekly":
    case "monthly":
      return period;
    default:
      return null;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected team focus period: ${String(value)}`);
}
