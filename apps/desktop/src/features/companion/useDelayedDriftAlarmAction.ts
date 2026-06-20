import { useCallback, useEffect, useState } from "react";
import type { DriftAlarmAction } from "./driftAlarmEvent";

const DRIFT_ALARM_ACTION_PENDING_MS = 300;

type DelayedDriftAlarmAction = Extract<DriftAlarmAction, { readonly type: "return_to_focus" | "start_break" }>;

type DelayedDriftAlarmActionControls = {
  readonly clearPendingDriftAlarmAction: () => void;
  readonly isBreakActionPending: boolean;
  readonly isDriftAlarmActionPending: boolean;
  readonly pendingFocusTargetId: string | null;
  readonly runDriftAlarmAction: (action: DriftAlarmAction) => void;
};

export function useDelayedDriftAlarmAction(
  onAction: (action: DriftAlarmAction) => void,
  isPreview: boolean,
): DelayedDriftAlarmActionControls {
  const [pendingAction, setPendingAction] = useState<DelayedDriftAlarmAction | null>(null);
  const isBreakActionPending = pendingAction?.type === "start_break";
  const pendingFocusTargetId = pendingAction?.type === "return_to_focus" ? pendingAction.targetId : null;

  useEffect(() => {
    if (!pendingAction) return undefined;
    const actionTimer = window.setTimeout(() => {
      setPendingAction(null);
      onAction(pendingAction);
    }, DRIFT_ALARM_ACTION_PENDING_MS);
    return () => window.clearTimeout(actionTimer);
  }, [onAction, pendingAction]);

  const clearPendingDriftAlarmAction = useCallback(() => setPendingAction(null), []);

  const runDriftAlarmAction = useCallback((action: DriftAlarmAction) => {
    if ((action.type === "return_to_focus" || action.type === "start_break") && !isPreview) {
      setPendingAction(action);
      return;
    }
    onAction(action);
  }, [isPreview, onAction]);

  return {
    clearPendingDriftAlarmAction,
    isBreakActionPending,
    isDriftAlarmActionPending: pendingAction !== null,
    pendingFocusTargetId,
    runDriftAlarmAction,
  };
}
