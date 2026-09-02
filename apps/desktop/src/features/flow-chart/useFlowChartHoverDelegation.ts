import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ANCHORED_PREVIEW_CARD_SELECTOR } from "../../components/anchoredCardPosition";
import { moveFlowHoverCardToPointer, type FlowHoverState } from "./FlowChartHoverCards";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

// Dense Flow cells can report several different groups inside one pointer
// sample. Let the destination settle for one frame so content does not flash
// through every intermediate cell.
const FLOW_HOVER_RETARGET_SETTLE_DELAY_MS = 16;

type FlowHoverBase = {
  readonly group: FlowBlockHoverGroup;
  readonly anchorElement: HTMLButtonElement;
  readonly triggerElement: HTMLButtonElement;
};

export type AnchoredFlowHoverState =
  | (FlowHoverBase & FlowHoverState & { readonly trigger: "pointer" })
  | (FlowHoverBase & { readonly trigger: "focus" });

type FlowChartHoverDelegationArgs = {
  readonly gridElement: HTMLDivElement | null;
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly setHoveredBlock: Dispatch<SetStateAction<AnchoredFlowHoverState | null>>;
  readonly disabled?: boolean;
};

type FlowHoverBridge = {
  readonly clearFocusHover: () => void;
  readonly dismissHover: () => void;
};

type PointerPosition = {
  readonly x: number;
  readonly y: number;
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
  cardRef,
  hoverGroupsByCell,
  setHoveredBlock,
  disabled = false,
}: FlowChartHoverDelegationArgs): FlowHoverBridge {
  const hoverGroupsRef = useRef(hoverGroupsByCell);
  const pointerHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const focusHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const retargetTimerRef = useRef<number | null>(null);
  const pendingPointerHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const latestPointerRef = useRef<PointerPosition | null>(null);
  const frameRef = useRef<number | null>(null);

  const publishHover = useCallback(() => {
    setHoveredBlock(focusHoverRef.current ?? pointerHoverRef.current);
  }, [setHoveredBlock]);

  const cancelPointerRetarget = useCallback(() => {
    pendingPointerHoverRef.current = null;
    if (retargetTimerRef.current === null) return;
    window.clearTimeout(retargetTimerRef.current);
    retargetTimerRef.current = null;
  }, []);

  const cancelPointerFrame = useCallback(() => {
    latestPointerRef.current = null;
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const commitPointerHover = useCallback((nextHover: AnchoredFlowHoverState) => {
    pointerHoverRef.current = nextHover;
    publishHover();
  }, [publishHover]);

  const clearPointerHover = useCallback(() => {
    cancelPointerRetarget();
    cancelPointerFrame();
    pointerHoverRef.current = null;
    publishHover();
  }, [cancelPointerFrame, cancelPointerRetarget, publishHover]);

  const schedulePointerRetarget = useCallback((nextHover: AnchoredFlowHoverState) => {
    if (pendingPointerHoverRef.current?.group === nextHover.group) return;
    cancelPointerRetarget();
    pendingPointerHoverRef.current = nextHover;
    retargetTimerRef.current = window.setTimeout(() => {
      const pendingHover = pendingPointerHoverRef.current;
      pendingPointerHoverRef.current = null;
      retargetTimerRef.current = null;
      if (!pendingHover?.anchorElement.isConnected) return;
      commitPointerHover(pendingHover);
    }, FLOW_HOVER_RETARGET_SETTLE_DELAY_MS);
  }, [cancelPointerRetarget, commitPointerHover]);

  const clearFocusHover = useCallback(() => {
    focusHoverRef.current = null;
    publishHover();
  }, [publishHover]);

  const dismissHover = useCallback(() => {
    cancelPointerRetarget();
    cancelPointerFrame();
    pointerHoverRef.current = null;
    focusHoverRef.current = null;
    publishHover();
  }, [cancelPointerFrame, cancelPointerRetarget, publishHover]);

  useEffect(() => {
    hoverGroupsRef.current = hoverGroupsByCell;
    dismissHover();
  }, [dismissHover, hoverGroupsByCell]);

  useEffect(() => {
    if (!gridElement || disabled) {
      dismissHover();
      return undefined;
    }

    const groupForCell = (cell: HTMLButtonElement): FlowBlockHoverGroup | null => {
      const minute = minuteFromCell(cell);
      return minute === null ? null : hoverGroupsRef.current.get(minute) ?? null;
    };
    const flushPointerMove = () => {
      frameRef.current = null;
      const pointer = latestPointerRef.current;
      if (!pointer) return;
      moveFlowHoverCardToPointer(cardRef.current, pointer.x, pointer.y);
    };
    const schedulePointerMove = (position: PointerPosition) => {
      latestPointerRef.current = position;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flushPointerMove);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const cell = hoverCellFromTarget(event.target, gridElement);
      const group = cell ? groupForCell(cell) : null;
      if (!cell || !group) {
        clearPointerHover();
        return;
      }
      const position = { x: event.clientX, y: event.clientY };
      schedulePointerMove(position);
      if (pointerHoverRef.current?.group === group) {
        cancelPointerRetarget();
        return;
      }
      const nextHover: AnchoredFlowHoverState = {
        group,
        anchorElement: cell,
        triggerElement: cell,
        trigger: "pointer",
        ...position,
      };
      if (pointerHoverRef.current === null) {
        cancelPointerRetarget();
        commitPointerHover(nextHover);
        return;
      }
      schedulePointerRetarget(nextHover);
    };
    const handlePointerWindowExit = () => clearPointerHover();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || focusHoverRef.current) return;
      clearPointerHover();
    };
    const handleFocusIn = (event: FocusEvent) => {
      cancelPointerRetarget();
      cancelPointerFrame();
      pointerHoverRef.current = null;
      const cell = hoverCellFromTarget(event.target, gridElement);
      if (cell?.dataset.activityPreviewFocusSuppressed === "true") {
        delete cell.dataset.activityPreviewFocusSuppressed;
        focusHoverRef.current = null;
        publishHover();
        return;
      }
      const group = cell ? groupForCell(cell) : null;
      focusHoverRef.current = cell && group
        ? { group, anchorElement: cell, triggerElement: cell, trigger: "focus" }
        : null;
      publishHover();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest(ANCHORED_PREVIEW_CARD_SELECTOR)) return;
      const nextCell = hoverCellFromTarget(event.relatedTarget, gridElement);
      const group = nextCell ? groupForCell(nextCell) : null;
      focusHoverRef.current = nextCell && group
        ? { group, anchorElement: nextCell, triggerElement: nextCell, trigger: "focus" }
        : null;
      publishHover();
    };

    gridElement.addEventListener("pointermove", handlePointerMove, { passive: true });
    gridElement.addEventListener("pointerleave", clearPointerHover);
    gridElement.addEventListener("focusin", handleFocusIn);
    gridElement.addEventListener("focusout", handleFocusOut);
    document.addEventListener("mouseleave", handlePointerWindowExit);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handlePointerWindowExit);
    return () => {
      gridElement.removeEventListener("pointermove", handlePointerMove);
      gridElement.removeEventListener("pointerleave", clearPointerHover);
      gridElement.removeEventListener("focusin", handleFocusIn);
      gridElement.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("mouseleave", handlePointerWindowExit);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handlePointerWindowExit);
      dismissHover();
    };
  }, [
    cancelPointerFrame,
    cancelPointerRetarget,
    cardRef,
    clearPointerHover,
    commitPointerHover,
    disabled,
    dismissHover,
    gridElement,
    publishHover,
    schedulePointerRetarget,
  ]);

  return { clearFocusHover, dismissHover };
}
