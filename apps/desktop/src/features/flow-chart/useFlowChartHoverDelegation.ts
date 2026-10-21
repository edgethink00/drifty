import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

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

export type AnchoredFlowHoverState = FlowHoverBase & { readonly trigger: "pointer" | "focus" };

type FlowChartHoverDelegationArgs = {
  readonly gridElement: HTMLDivElement | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly setHoveredBlock: Dispatch<SetStateAction<AnchoredFlowHoverState | null>>;
  readonly previewAnchorRef: MutableRefObject<AnchoredFlowHoverState | null>;
  readonly disabled?: boolean;
  /** The open activity, which focus alone must not keep previewing. */
  readonly pinnedGroup?: FlowBlockHoverGroup | null;
};

type FlowHoverBridge = {
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
  previewAnchorRef,
  disabled = false,
  pinnedGroup = null,
}: FlowChartHoverDelegationArgs): FlowHoverBridge {
  const hoverGroupsRef = useRef(hoverGroupsByCell);
  const pointerHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const focusHoverRef = useRef<AnchoredFlowHoverState | null>(null);
  const retargetTimerRef = useRef<number | null>(null);
  const pendingPointerHoverRef = useRef<AnchoredFlowHoverState | null>(null);

  const pinnedGroupRef = useRef(pinnedGroup);
  pinnedGroupRef.current = pinnedGroup;
  const publishHover = useCallback(() => {
    // A clicked cell keeps focus while its activity stays open beside the
    // chart; that focus must not hide the preview of the cell being pointed at.
    const focusHover = focusHoverRef.current?.group === pinnedGroupRef.current ? null : focusHoverRef.current;
    const hover = focusHover ?? pointerHoverRef.current;
    previewAnchorRef.current = hover;
    setHoveredBlock(hover);
  }, [previewAnchorRef, setHoveredBlock]);

  const cancelPointerRetarget = useCallback(() => {
    pendingPointerHoverRef.current = null;
    if (retargetTimerRef.current === null) return;
    window.clearTimeout(retargetTimerRef.current);
    retargetTimerRef.current = null;
  }, []);

  const commitPointerHover = useCallback((nextHover: AnchoredFlowHoverState) => {
    pointerHoverRef.current = nextHover;
    publishHover();
  }, [publishHover]);

  const clearPointerHover = useCallback(() => {
    cancelPointerRetarget();
    pointerHoverRef.current = null;
    publishHover();
  }, [cancelPointerRetarget, publishHover]);

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

  const dismissHover = useCallback(() => {
    cancelPointerRetarget();
    pointerHoverRef.current = null;
    focusHoverRef.current = null;
    publishHover();
  }, [cancelPointerRetarget, publishHover]);

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
    let pointerActivationCell: HTMLButtonElement | null = null;
    const clearPointerActivation = () => { pointerActivationCell = null; };
    const handlePointerDown = (event: PointerEvent) => {
      pointerActivationCell = event.button === 0 ? hoverCellFromTarget(event.target, gridElement) : null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const cell = hoverCellFromTarget(event.target, gridElement);
      const group = cell ? groupForCell(cell) : null;
      if (!cell || !group) {
        clearPointerHover();
        return;
      }
      if (pointerHoverRef.current?.group === group) {
        cancelPointerRetarget();
        return;
      }
      const nextHover: AnchoredFlowHoverState = {
        group,
        anchorElement: cell,
        triggerElement: cell,
        trigger: "pointer",
      };
      if (pointerHoverRef.current === null) {
        cancelPointerRetarget();
        commitPointerHover(nextHover);
        return;
      }
      schedulePointerRetarget(nextHover);
    };
    const handlePointerWindowExit = () => {
      clearPointerActivation();
      clearPointerHover();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      clearPointerActivation();
      if (event.key !== "Escape" || event.defaultPrevented || focusHoverRef.current) return;
      clearPointerHover();
    };
    const handleFocusIn = (event: FocusEvent) => {
      cancelPointerRetarget();
      const pointerHover = pointerHoverRef.current;
      pointerHoverRef.current = null;
      const cell = hoverCellFromTarget(event.target, gridElement);
      const isPointerActivation = cell !== null && cell === pointerActivationCell;
      clearPointerActivation();
      if (cell?.dataset.activityPreviewFocusSuppressed === "true") {
        delete cell.dataset.activityPreviewFocusSuppressed;
        focusHoverRef.current = null;
        publishHover();
        return;
      }
      const group = cell ? groupForCell(cell) : null;
      focusHoverRef.current = cell && group
        ? {
            group,
            // Pointer activation focuses the clicked cell before its click
            // handler. Keep the visible preview anchored through that step.
            anchorElement: isPointerActivation && pointerHover?.group === group ? pointerHover.anchorElement : cell,
            triggerElement: cell,
            trigger: "focus",
          }
        : null;
      publishHover();
    };
    const handleFocusOut = (event: FocusEvent) => {
      const nextCell = hoverCellFromTarget(event.relatedTarget, gridElement);
      const group = nextCell ? groupForCell(nextCell) : null;
      focusHoverRef.current = nextCell && group
        ? { group, anchorElement: nextCell, triggerElement: nextCell, trigger: "focus" }
        : null;
      publishHover();
    };

    gridElement.addEventListener("pointermove", handlePointerMove, { passive: true });
    const handleScroll = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.contains(gridElement)) clearPointerHover();
    };
    document.addEventListener("scroll", handleScroll, true);
    gridElement.addEventListener("pointerleave", clearPointerHover);
    gridElement.addEventListener("focusin", handleFocusIn);
    gridElement.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", clearPointerActivation, true);
    document.addEventListener("pointercancel", clearPointerActivation, true);
    document.addEventListener("mouseleave", handlePointerWindowExit);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handlePointerWindowExit);
    return () => {
      gridElement.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("scroll", handleScroll, true);
      gridElement.removeEventListener("pointerleave", clearPointerHover);
      gridElement.removeEventListener("focusin", handleFocusIn);
      gridElement.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", clearPointerActivation, true);
      document.removeEventListener("pointercancel", clearPointerActivation, true);
      document.removeEventListener("mouseleave", handlePointerWindowExit);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handlePointerWindowExit);
      dismissHover();
    };
  }, [
    cancelPointerRetarget,
    clearPointerHover,
    commitPointerHover,
    disabled,
    dismissHover,
    gridElement,
    publishHover,
    schedulePointerRetarget,
  ]);

  return { dismissHover };
}
