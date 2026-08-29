import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { FlowHoverCard, moveFlowHoverCardToPointer, type FlowHoverState } from "../flow-chart/FlowChartHoverCards";
import type { FlowBlockHoverGroup } from "../flow-chart/flowHoverGroups";

function eventElementFromTarget(target: EventTarget | null, body: HTMLDivElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-agent-hover-id]");
  if (!element || !body.contains(element)) return null;
  return element;
}

/**
 * Pointer/focus hover for the agent week calendar. The normal Week dashboard
 * owns the same interaction in WeekCalendarHoverLayer; agent runs use Flow's
 * existing hover card because their source data is already FlowBlock-shaped.
 */
export function AgentsWeekHoverLayer({
  bodyElement,
  groupsById,
}: {
  readonly bodyElement: HTMLDivElement | null;
  readonly groupsById: ReadonlyMap<string, FlowBlockHoverGroup>;
}) {
  const [hover, setHover] = useState<FlowHoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const groupsByIdRef = useRef(groupsById);
  const activeGroupRef = useRef<FlowBlockHoverGroup | null>(null);
  const pointerGroupRef = useRef<FlowBlockHoverGroup | null>(null);
  const focusHoverRef = useRef<FlowHoverState | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    groupsByIdRef.current = groupsById;
    pointerGroupRef.current = null;
    latestPointerRef.current = null;
    const focusedElement = bodyElement ? eventElementFromTarget(document.activeElement, bodyElement) : null;
    const focusedId = focusedElement?.dataset.agentHoverId;
    const focusedGroup = focusedId ? groupsById.get(focusedId) : undefined;
    if (focusedElement && focusedGroup) {
      const bounds = focusedElement.getBoundingClientRect();
      const nextHover = { group: focusedGroup, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      focusHoverRef.current = nextHover;
      activeGroupRef.current = focusedGroup;
      setHover(nextHover);
    } else {
      focusHoverRef.current = null;
      activeGroupRef.current = null;
      setHover(null);
    }
  }, [bodyElement, groupsById]);

  useEffect(() => {
    if (!bodyElement) return undefined;

    const clearPointerHover = () => {
      latestPointerRef.current = null;
      pointerGroupRef.current = null;
      const focusHover = focusHoverRef.current;
      activeGroupRef.current = focusHover?.group ?? null;
      setHover(focusHover);
    };
    const flushPointerMove = () => {
      frameRef.current = null;
      const pointer = latestPointerRef.current;
      if (pointer) moveFlowHoverCardToPointer(cardRef.current, pointer.x, pointer.y);
    };
    const schedulePointerMove = (x: number, y: number) => {
      latestPointerRef.current = { x, y };
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(flushPointerMove);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const element = eventElementFromTarget(event.target, bodyElement);
      const eventId = element?.dataset.agentHoverId;
      const group = eventId ? groupsByIdRef.current.get(eventId) : undefined;
      if (!group) {
        if (pointerGroupRef.current) clearPointerHover();
        return;
      }
      pointerGroupRef.current = group;
      schedulePointerMove(event.clientX, event.clientY);
      if (activeGroupRef.current === group) return;
      activeGroupRef.current = group;
      setHover({ group, x: event.clientX, y: event.clientY });
    };
    const handleFocusIn = (event: FocusEvent) => {
      const element = eventElementFromTarget(event.target, bodyElement);
      const eventId = element?.dataset.agentHoverId;
      const group = eventId ? groupsByIdRef.current.get(eventId) : undefined;
      if (!element || !group) return;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const bounds = element.getBoundingClientRect();
      const nextHover = { group, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      focusHoverRef.current = nextHover;
      activeGroupRef.current = group;
      setHover(nextHover);
    };
    const handleFocusOut = () => {
      focusHoverRef.current = null;
      const pointer = latestPointerRef.current;
      const pointerGroup = pointerGroupRef.current;
      if (pointer && pointerGroup) {
        activeGroupRef.current = pointerGroup;
        setHover({ group: pointerGroup, x: pointer.x, y: pointer.y });
      } else {
        activeGroupRef.current = null;
        setHover(null);
      }
    };

    bodyElement.addEventListener("pointermove", handlePointerMove, { passive: true });
    bodyElement.addEventListener("pointerleave", clearPointerHover);
    bodyElement.addEventListener("focusin", handleFocusIn);
    bodyElement.addEventListener("focusout", handleFocusOut);
    return () => {
      bodyElement.removeEventListener("pointermove", handlePointerMove);
      bodyElement.removeEventListener("pointerleave", clearPointerHover);
      bodyElement.removeEventListener("focusin", handleFocusIn);
      bodyElement.removeEventListener("focusout", handleFocusOut);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      activeGroupRef.current = null;
      pointerGroupRef.current = null;
      focusHoverRef.current = null;
      latestPointerRef.current = null;
    };
  }, [bodyElement]);

  useLayoutEffect(() => {
    if (!hover) return;
    moveFlowHoverCardToPointer(cardRef.current, hover.x, hover.y);
  }, [hover]);

  return hover ? <FlowHoverCard hover={hover} appIcons={{}} cardRef={cardRef} showClassificationSource={false} /> : null;
}
