import { useCallback, useEffect, useState } from "react";
import type { DriftAlarmAction } from "./driftAlarmEvent";

const BREAK_ACTION_PENDING_MS = 300;

type DriftAlarmStartBreakAction = Extract<DriftAlarmAction, { readonly type: "start_break" }>;

type DelayedDriftAlarmActionControls = {
  readonly clearPendingBreakAction: () => void;
  readonly isBreakActionPending: boolean;
  readonly runDriftAlarmAction: (action: DriftAlarmAction) => void;
};

export function useDelayedDriftAlarmAction(
  onAction: (action: DriftAlarmAction) => void,
  isPreview: boolean,
): DelayedDriftAlarmActionControls {
  const [pendingBreakAction, setPendingBreakAction] = useState<DriftAlarmStartBreakAction | null>(null);
  const isBreakActionPending = pendingBreakAction !== null;

  useEffect(() => {
    if (!pendingBreakAction) return undefined;
    const actionTimer = window.setTimeout(() => {
      setPendingBreakAction(null);
      onAction(pendingBreakAction);
    }, BREAK_ACTION_PENDING_MS);
    return () => window.clearTimeout(actionTimer);
  }, [onAction, pendingBreakAction]);

  const clearPendingBreakAction = useCallback(() => setPendingBreakAction(null), []);

  const runDriftAlarmAction = useCallback((action: DriftAlarmAction) => {
    if (action.type === "start_break" && !isPreview) {
      setPendingBreakAction(action);
      return;
    }
    onAction(action);
  }, [isPreview, onAction]);

  return {
    clearPendingBreakAction,
    isBreakActionPending,
    runDriftAlarmAction,
  };
}
