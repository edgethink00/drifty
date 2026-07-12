import { useEffect, useRef, useState } from "react";
import type { AppIconMap } from "@drifty/domain";
import { moveFlowHoverCardToPointer } from "../flow-chart/FlowChartHoverCards";
import { WeekCalendarHoverCard } from "./HoverCards";
import type { WeekCalendarHoverState } from "./HoverCards";
import type { WeekCalendarEvent } from "./weekCalendar";

const HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX = "29";

type WeekCalendarHoverLayerProps = {
  readonly bodyElement: HTMLDivElement | null;
  readonly eventsById: ReadonlyMap<string, WeekCalendarEvent>;
  readonly appIcons: AppIconMap;
};

type LiftedEventElement = {
  readonly element: HTMLElement;
  readonly restoreZIndex: string;
};

function eventElementFromTarget(target: EventTarget | null, body: HTMLDivElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const eventElement = target.closest<HTMLElement>(".week-v2-calendar__event[data-event-id]");
  if (!eventElement || !body.contains(eventElement)) return null;
  return eventElement;
}

function liftEventElement(element: HTMLElement): LiftedEventElement {
  const restoreZIndex = element.style.zIndex;
  element.style.zIndex = HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX;
  return { element, restoreZIndex };
}

function dropLiftedEventElement(lifted: LiftedEventElement | null): null {
  if (lifted) lifted.element.style.zIndex = lifted.restoreZIndex;
  return null;
}

/* Owns the pointer-driven hover state so that moving across events re-renders
 * only this layer — never the calendar grid or the Breakdown side panel (the
 * same pattern as the Day flow chart's FlowHoverLayer). Within one event the
 * card follows the pointer through direct DOM writes without any React state
 * or layout measurement; the hovered event's z-index lift is a direct style
 * write too. */
export function WeekCalendarHoverLayer({ bodyElement, eventsById, appIcons }: WeekCalendarHoverLayerProps) {
  const [hover, setHover] = useState<WeekCalendarHoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const eventsByIdRef = useRef(eventsById);
  const hoverLiftRef = useRef<LiftedEventElement | null>(null);
  const focusLiftRef = useRef<LiftedEventElement | null>(null);
  const activeEventIdRef = useRef<string | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    eventsByIdRef.current = eventsById;
    activeEventIdRef.current = null;
    hoverLiftRef.current = dropLiftedEventElement(hoverLiftRef.current);
    focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current);
    setHover(null);
  }, [eventsById]);

  useEffect(() => {
    if (!bodyElement) return undefined;

    const clearHover = () => {
      latestPointerRef.current = null;
      if (activeEventIdRef.current === null) return;
      activeEventIdRef.current = null;
      hoverLiftRef.current = dropLiftedEventElement(hoverLiftRef.current);
      setHover(null);
    };
    const flushPointerMove = () => {
      frameRef.current = null;
      const pointer = latestPointerRef.current;
      if (!pointer) return;
      moveFlowHoverCardToPointer(cardRef.current, pointer.x, pointer.y);
    };
    const schedulePointerMove = (x: number, y: number) => {
      latestPointerRef.current = { x, y };
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flushPointerMove);
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const eventElement = eventElementFromTarget(moveEvent.target, bodyElement);
      if (!eventElement) {
        clearHover();
        return;
      }
      const eventId = eventElement.dataset.eventId ?? null;
      const calendarEvent = eventId === null ? undefined : eventsByIdRef.current.get(eventId);
      if (!calendarEvent) {
        clearHover();
        return;
      }
      if (activeEventIdRef.current === eventId) {
        schedulePointerMove(moveEvent.clientX, moveEvent.clientY);
        return;
      }
      activeEventIdRef.current = eventId;
      hoverLiftRef.current = dropLiftedEventElement(hoverLiftRef.current);
      hoverLiftRef.current = liftEventElement(eventElement);
      latestPointerRef.current = null;
      setHover({ event: calendarEvent, x: moveEvent.clientX, y: moveEvent.clientY });
    };
    const handleMouseLeave = () => clearHover();
    const handleFocusIn = (focusEvent: FocusEvent) => {
      const eventElement = eventElementFromTarget(focusEvent.target, bodyElement);
      focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current);
      if (eventElement) focusLiftRef.current = liftEventElement(eventElement);
    };
    const handleFocusOut = () => {
      focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current);
    };

    bodyElement.addEventListener("mousemove", handleMouseMove);
    bodyElement.addEventListener("mouseleave", handleMouseLeave);
    bodyElement.addEventListener("focusin", handleFocusIn);
    bodyElement.addEventListener("focusout", handleFocusOut);
    return () => {
      bodyElement.removeEventListener("mousemove", handleMouseMove);
      bodyElement.removeEventListener("mouseleave", handleMouseLeave);
      bodyElement.removeEventListener("focusin", handleFocusIn);
      bodyElement.removeEventListener("focusout", handleFocusOut);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      activeEventIdRef.current = null;
      hoverLiftRef.current = dropLiftedEventElement(hoverLiftRef.current);
      focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current);
    };
  }, [bodyElement]);

  return hover ? <WeekCalendarHoverCard hover={hover} appIcons={appIcons} cardRef={cardRef} /> : null;
}
