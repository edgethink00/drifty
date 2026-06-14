import { useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { moveFlowHoverCardToPointer, type FlowHoverState } from "./FlowChartHoverCards";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

type FlowChartHoverDelegationArgs = {
  readonly gridRef: RefObject<HTMLDivElement | null>;
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly setHoveredBlock: Dispatch<SetStateAction<FlowHoverState | null>>;
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
  gridRef,
  cardRef,
  hoverGroupsByCell,
  setHoveredBlock,
}: FlowChartHoverDelegationArgs): void {
  const hoverGroupsRef = useRef(hoverGroupsByCell);
  const activeGroupRef = useRef<FlowBlockHoverGroup | null>(null);
  const latestPointerRef = useRef<PointerPosition | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    hoverGroupsRef.current = hoverGroupsByCell;
    activeGroupRef.current = null;
  }, [hoverGroupsByCell]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;

    const clearHover = () => {
      if (activeGroupRef.current === null) return;
      activeGroupRef.current = null;
      setHoveredBlock(null);
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
      const cell = hoverCellFromTarget(event.target, grid);
      if (!cell) {
        clearHover();
        return;
      }
      const minute = minuteFromCell(cell);
      const group = minute === null ? undefined : hoverGroupsRef.current.get(minute);
      if (!group) {
        clearHover();
        return;
      }
      const position = { x: event.clientX, y: event.clientY };
      schedulePointerMove(position);
      if (activeGroupRef.current === group) return;
      activeGroupRef.current = group;
      setHoveredBlock({ group, ...position });
    };

    grid.addEventListener("pointermove", handlePointerMove, { passive: true });
    grid.addEventListener("pointerleave", clearHover);
    return () => {
      grid.removeEventListener("pointermove", handlePointerMove);
      grid.removeEventListener("pointerleave", clearHover);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [cardRef, gridRef, setHoveredBlock]);
}
