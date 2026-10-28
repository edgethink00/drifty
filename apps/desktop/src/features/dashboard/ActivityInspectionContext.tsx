import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";
import type { WeekCalendarEvent } from "./weekCalendar";

export type ActivityInspectionOptions = {
  readonly presentation: "popover" | "panel";
  /** What pointing at a block shows: "full" floats a preview card beside it; "off" only highlights the block. */
  readonly hover: ActivityHoverMode;
};

/**
 * The detail of the hours-down Your Day and its Week: a click opens the activity in
 * the Breakdown panel (name edit, delete in the bottom bar, its activities in time order); pointing
 * at a block only highlights it and its card, also while another is open, with no floating card
 * (owner, 2026-10-20). The hours-across layout keeps the popover and its preview card.
 */
export const YOUR_DAY_ROWS_INSPECTION: ActivityInspectionOptions = {
  presentation: "panel",
  hover: "off",
};

export type ActivityHoverMode = "full" | "off";

/** Whether pointing at a block floats a preview card beside it. */
export function hoverFloatsCard(hover: ActivityHoverMode): boolean {
  return hover === "full";
}

/**
 * Whether pointing at another block still responds while one is open. The side panel leaves the
 * chart uncovered, so it does there; an open popover takes the pointer's place.
 */
export function hoversWhileSelected(inspection: ActivityInspectionOptions): boolean {
  return inspection.presentation === "panel";
}

/**
 * The Day card the user just clicked. The card opens the panel through a chart cell of its time;
 * the panel then describes and edits the card the user chose (its time, records and their
 * values), not just that cell's run (owner review, 2026-10-28).
 */
export type ActivityLaneSelection = {
  readonly label: ActivityInspectorLabel | null;
  /** The card as drawn: its time and records, short pieces folded into it included. */
  readonly stretch: ActivityLogStretch;
  readonly atMs: number;
  /** The card itself, so its records are what the panel's values, project and delete change. */
  readonly event?: WeekCalendarEvent;
  readonly projectBySegmentId?: ReadonlyMap<string, string | null>;
};

/** The stretch the panel's log describes. */
export type ActivityLogStretch = { readonly startMs: number; readonly endMs: number; readonly segmentIds: readonly string[] };

type ActivityInspectionState = ActivityInspectionOptions & {
  readonly panelElement: HTMLElement | null;
  readonly panelActive: boolean;
  readonly registerPanel: (element: HTMLElement | null) => void;
  readonly registerSelection: (close: () => void) => () => void;
  readonly dismissSelection: () => void;
  readonly laneSelection: { current: ActivityLaneSelection | null };
};

const defaultOptions: ActivityInspectionOptions = { presentation: "popover", hover: "full" };
const noop = () => {};
const ActivityInspectionContext = createContext<ActivityInspectionState>({
  ...defaultOptions, panelElement: null, panelActive: false,
  registerPanel: noop, registerSelection: () => noop, dismissSelection: noop, laneSelection: { current: null },
});

/** Shares a selected activity's destination without moving chart state or records. */
export function ActivityInspectionProvider({ options = defaultOptions, scopeKey, onRequestOpen, children }: {
  readonly options?: ActivityInspectionOptions;
  readonly scopeKey: string;
  readonly onRequestOpen: () => void;
  readonly children: ReactNode;
}) {
  const [panelElement, registerPanel] = useState<HTMLElement | null>(null);
  const [panelActive, setPanelActive] = useState(false);
  const selection = useRef<{ close: () => void } | null>(null);
  const laneSelection = useRef<ActivityLaneSelection | null>(null);
  const requestOpen = useRef(onRequestOpen);
  requestOpen.current = onRequestOpen;
  const registerSelection = useCallback((close: () => void) => {
    const entry = { close };
    selection.current = entry;
    setPanelActive(true);
    requestOpen.current();
    return () => {
      if (selection.current !== entry) return;
      selection.current = null;
      setPanelActive(false);
    };
  }, []);
  const dismissSelection = useCallback(() => selection.current?.close(), []);
  const previousScope = useRef(scopeKey);
  useLayoutEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey;
      dismissSelection();
    }
  }, [dismissSelection, scopeKey]);
  const value = useMemo(() => ({ ...options, panelElement, panelActive, registerPanel, registerSelection, dismissSelection, laneSelection }),
    [options, panelElement, panelActive, registerSelection, dismissSelection]);
  return <ActivityInspectionContext.Provider value={value}>{children}</ActivityInspectionContext.Provider>;
}

export function useActivityInspection() {
  return useContext(ActivityInspectionContext);
}
