import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS } from "../../components/anchoredCardPosition";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

export type AnchoredFlowHoverState = {
  readonly group: FlowBlockHoverGroup;
  readonly anchorElement: HTMLButtonElement;
  readonly triggerElement: HTMLButtonElement;
  readonly trigger: "pointer" | "focus";
};

type FlowChartHoverDelegationArgs = {
  readonly gridElement: HTMLDivElement | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly setHoveredBlock: Dispatch<SetStateAction<AnchoredFlowHoverState | null>>;
  readonly disabled?: boolean;
};

type FlowHoverBridge = {
  readonly cancelPointerClear: () => void;
  readonly schedulePointerClear: () => void;
  readonly clearFocusHover: () => void;
  readonly dismissHover: () => void;
};

function hoverCellFromTarget(target: EventTarget | null, grid: HTMLDivElement): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLButtonElement>("button.flow-cell[data-flow-minute]");
  if (!cell || !grid.contains(cell)) return null;
  return cell;
}

function minuteFromCell(cell: HTMLButtonElement): number | null {
  const rawMinute = cell.dataset.flowMinute;
  if (rawMinute === undefined) return null;
  const minute = Number(rawMinute);
  return Number.isInteger(minute) ? minute : null;
}

export function useFlowChartHoverDelegation({
  gridElement,
  hoverGroupsByCell,
  setHoveredBlock,
  disabled = false,
}: FlowChartHoverDelegationArgs): FlowHoverBridge {
  const hoverGroupsRef = useRef(hoverGroupsByCell);
  const pointerHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const focusHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const publishHover = useCallback(() => {
    setHoveredBlock(focusHoverRef.current ?? pointerHoverRef.current);
  }, [setHoveredBlock]);

  const cancelPointerClear = useCallback(() => {
    if (clearTimerRef.current === null) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const clearPointerHover = useCallback(() => {
    cancelPointerClear();
    pointerHoverRef.current = null;
    publishHover();
  }, [cancelPointerClear, publishHover]);

  const schedulePointerClear = useCallback(() => {
    if (clearTimerRef.current !== null) return;
    clearTimerRef.current = window.setTimeout(clearPointerHover, ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS);
  }, [clearPointerHover]);

  const clearFocusHover = useCallback(() => {
    focusHoverRef.current = null;
    publishHover();
  }, [publishHover]);

  const dismissHover = useCallback(() => {
    cancelPointerClear();
    pointerHoverRef.current = null;
    focusHoverRef.current = null;
    publishHover();
  }, [cancelPointerClear, publishHover]);

  useEffect(() => {
    hoverGroupsRef.current = hoverGroupsByCell;
    dismissHover();
  }, [dismissHover, hoverGroupsByCell]);

  useEffect(() => {
    if (!gridElement || disabled) {
      dismissHover();
      return undefined;
    }

    const hoverForCell = (
      cell: HTMLButtonElement,
      trigger: AnchoredFlowHoverState["trigger"],
    ): AnchoredFlowHoverState | null => {
      const minute = minuteFromCell(cell);
      const group = minute === null ? undefined : hoverGroupsRef.current.get(minute);
      return group ? { group, anchorElement: cell, triggerElement: cell, trigger } : null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const cell = hoverCellFromTarget(event.target, gridElement);
      const nextHover = cell ? hoverForCell(cell, "pointer") : null;
      if (!nextHover) {
        schedulePointerClear();
        return;
      }
      cancelPointerClear();
      if (pointerHoverRef.current?.group === nextHover.group) return;
      pointerHoverRef.current = nextHover;
      publishHover();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const cell = hoverCellFromTarget(event.target, gridElement);
      if (cell?.dataset.activityPreviewFocusSuppressed === "true") {
        delete cell.dataset.activityPreviewFocusSuppressed;
        focusHoverRef.current = null;
        publishHover();
        return;
      }
      focusHoverRef.current = cell ? hoverForCell(cell, "focus") : null;
      publishHover();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".week-activity-inspector--preview")) return;
      const nextCell = hoverCellFromTarget(event.relatedTarget, gridElement);
      focusHoverRef.current = nextCell ? hoverForCell(nextCell, "focus") : null;
      publishHover();
    };

    gridElement.addEventListener("pointermove", handlePointerMove, { passive: true });
    gridElement.addEventListener("pointerleave", schedulePointerClear);
    gridElement.addEventListener("focusin", handleFocusIn);
    gridElement.addEventListener("focusout", handleFocusOut);
    return () => {
      gridElement.removeEventListener("pointermove", handlePointerMove);
      gridElement.removeEventListener("pointerleave", schedulePointerClear);
      gridElement.removeEventListener("focusin", handleFocusIn);
      gridElement.removeEventListener("focusout", handleFocusOut);
      dismissHover();
    };
  }, [cancelPointerClear, disabled, dismissHover, gridElement, publishHover, schedulePointerClear]);

  return { cancelPointerClear, schedulePointerClear, clearFocusHover, dismissHover };
}
