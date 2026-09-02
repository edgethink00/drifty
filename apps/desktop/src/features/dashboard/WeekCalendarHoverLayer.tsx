import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, AppIconMap, ClassificationOptions } from "@drifty/domain";
import {
  ActivityInspectorPreview,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorAttribute,
  type ActivityInspectorProjectOption,
  type ActivityInspectorView,
} from "./WeekActivityInspector";
import { ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS } from "../../components/anchoredCardPosition";
import type { WeekCalendarEvent } from "./weekCalendar";
import { buildWeekActivityInspectorEvent } from "./weekActivityInspectorEvent";
import { useLocalization } from "../localization/LocalizationContext";

const HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX = "29";
// Retargeting only waits long enough for the current portal geometry to settle.
// The longer shared delay remains reserved for crossing empty space into a card.
const WEEK_HOVER_RETARGET_SETTLE_DELAY_MS = 16;
const WEEK_PREVIEW_POINTER_SURFACE_SELECTOR = ".week-activity-inspector--preview, .week-activity-inspector__hover-bridge";
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];
const EMPTY_PROJECT_BY_SEGMENT_ID: ReadonlyMap<string, string | null> = new Map();

type WeekCalendarHoverLayerProps = {
  readonly bodyElement: HTMLDivElement | null;
  readonly eventsById: ReadonlyMap<string, WeekCalendarEvent>;
  readonly segmentsById: ReadonlyMap<string, ActivitySegment>;
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly activityActionsEnabled?: boolean;
  readonly classificationOptions?: ClassificationOptions;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly projectBySegmentId?: ReadonlyMap<string, string | null>;
  readonly hasAssignProjectAction?: boolean;
  readonly hasClassifyAction?: boolean;
  readonly hasDeleteAction?: boolean;
  readonly onOpenActivity?: (
    event: WeekCalendarEvent,
    target: HTMLElement,
    initialView: ActivityInspectorView,
  ) => void;
  readonly disabled?: boolean;
};

type AnchoredWeekHover = {
  readonly event: WeekCalendarEvent;
  readonly anchorElement: HTMLElement;
};

type PointerPosition = {
  readonly x: number;
  readonly y: number;
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

function liftEventElement(element: HTMLElement, inheritedLift: LiftedEventElement | null = null): LiftedEventElement {
  const restoreZIndex = inheritedLift?.element === element ? inheritedLift.restoreZIndex : element.style.zIndex;
  element.style.zIndex = HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX;
  return { element, restoreZIndex };
}

function dropLiftedEventElement(lifted: LiftedEventElement | null, remainingLift: LiftedEventElement | null = null): null {
  if (lifted) {
    lifted.element.style.zIndex = remainingLift?.element === lifted.element
      ? HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX
      : lifted.restoreZIndex;
  }
  return null;
}

// Pointer and keyboard focus are tracked independently so a focused block keeps
// its preview after the pointer leaves. The shared grace delay supplements the
// portaled card's transparent hit target for slower or diagonal movement.
export function WeekCalendarHoverLayer({
  bodyElement,
  eventsById,
  segmentsById,
  appIcons,
  deviceLabelById,
  activityActionsEnabled = false,
  classificationOptions,
  projectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  projectBySegmentId = EMPTY_PROJECT_BY_SEGMENT_ID,
  hasAssignProjectAction = false,
  hasClassifyAction = false,
  hasDeleteAction = false,
  onOpenActivity,
  disabled = false,
}: WeekCalendarHoverLayerProps) {
  const { t } = useLocalization();
  const projectsById = useMemo(
    () => new Map(projectOptions.flatMap((project) => project.id ? [[project.id, project] as const] : [])),
    [projectOptions],
  );
  const [pointerHover, setPointerHover] = useState<AnchoredWeekHover | null>(null);
  const [focusHover, setFocusHover] = useState<AnchoredWeekHover | null>(null);
  const eventsByIdRef = useRef(eventsById);
  const pointerEventIdRef = useRef<string | null>(null);
  const pointerLiftRef = useRef<LiftedEventElement | null>(null);
  const focusLiftRef = useRef<LiftedEventElement | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const retargetTimerRef = useRef<number | null>(null);
  const pendingPointerHoverRef = useRef<AnchoredWeekHover | null>(null);
  const pointerPositionRef = useRef<PointerPosition | null>(null);

  const isPointerInsideCurrentPreview = useCallback(() => {
    const pointerPosition = pointerPositionRef.current;
    if (!pointerPosition) return false;
    const hitElement = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(pointerPosition.x, pointerPosition.y)
      : null;
    if (hitElement?.closest(WEEK_PREVIEW_POINTER_SURFACE_SELECTOR)) return true;
    return Array.from(document.querySelectorAll<HTMLElement>(WEEK_PREVIEW_POINTER_SURFACE_SELECTOR)).some((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return pointerPosition.x >= rect.left
        && pointerPosition.x <= rect.right
        && pointerPosition.y >= rect.top
        && pointerPosition.y <= rect.bottom;
    });
  }, []);

  const cancelPointerClear = useCallback(() => {
    if (clearTimerRef.current === null) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const cancelPointerRetarget = useCallback(() => {
    pendingPointerHoverRef.current = null;
    if (retargetTimerRef.current === null) return;
    window.clearTimeout(retargetTimerRef.current);
    retargetTimerRef.current = null;
  }, []);

  const commitPointerHover = useCallback((nextHover: AnchoredWeekHover) => {
    pointerEventIdRef.current = nextHover.event.id;
    pointerLiftRef.current = dropLiftedEventElement(pointerLiftRef.current, focusLiftRef.current);
    pointerLiftRef.current = liftEventElement(nextHover.anchorElement, focusLiftRef.current);
    setPointerHover(nextHover);
  }, []);

  const clearPointerHover = useCallback(() => {
    cancelPointerClear();
    cancelPointerRetarget();
    pointerEventIdRef.current = null;
    pointerPositionRef.current = null;
    pointerLiftRef.current = dropLiftedEventElement(pointerLiftRef.current, focusLiftRef.current);
    setPointerHover(null);
  }, [cancelPointerClear, cancelPointerRetarget]);

  const schedulePointerClear = useCallback(() => {
    cancelPointerRetarget();
    if (clearTimerRef.current !== null) return;
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      if (isPointerInsideCurrentPreview()) return;
      clearPointerHover();
    }, ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS);
  }, [cancelPointerRetarget, clearPointerHover, isPointerInsideCurrentPreview]);

  const schedulePointerRetarget = useCallback((nextHover: AnchoredWeekHover) => {
    cancelPointerClear();
    if (pendingPointerHoverRef.current?.event.id === nextHover.event.id) {
      pendingPointerHoverRef.current = nextHover;
      return;
    }
    cancelPointerRetarget();
    pendingPointerHoverRef.current = nextHover;
    retargetTimerRef.current = window.setTimeout(() => {
      const pendingHover = pendingPointerHoverRef.current;
      pendingPointerHoverRef.current = null;
      retargetTimerRef.current = null;
      if (!pendingHover?.anchorElement.isConnected) return;
      if (isPointerInsideCurrentPreview()) return;
      commitPointerHover(pendingHover);
    }, WEEK_HOVER_RETARGET_SETTLE_DELAY_MS);
  }, [cancelPointerClear, cancelPointerRetarget, commitPointerHover, isPointerInsideCurrentPreview]);

  const holdPointerHover = useCallback(() => {
    cancelPointerClear();
    cancelPointerRetarget();
  }, [cancelPointerClear, cancelPointerRetarget]);

  const clearFocusHover = useCallback(() => {
    focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current, pointerLiftRef.current);
    setFocusHover(null);
  }, []);

  const dismissPreview = useCallback(() => {
    clearPointerHover();
    clearFocusHover();
  }, [clearFocusHover, clearPointerHover]);

  useEffect(() => {
    eventsByIdRef.current = eventsById;
    dismissPreview();
  }, [dismissPreview, eventsById]);

  useEffect(() => {
    if (!bodyElement || disabled) {
      dismissPreview();
      return undefined;
    }

    const hoverForElement = (eventElement: HTMLElement): AnchoredWeekHover | null => {
      const eventId = eventElement.dataset.eventId ?? null;
      const calendarEvent = eventId === null ? undefined : eventsByIdRef.current.get(eventId);
      return calendarEvent ? { event: calendarEvent, anchorElement: eventElement } : null;
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const eventElement = eventElementFromTarget(moveEvent.target, bodyElement);
      if (!eventElement) {
        schedulePointerClear();
        return;
      }
      const nextHover = hoverForElement(eventElement);
      if (!nextHover) {
        schedulePointerClear();
        return;
      }
      cancelPointerClear();
      if (pointerEventIdRef.current === nextHover.event.id) {
        cancelPointerRetarget();
        return;
      }
      if (pointerEventIdRef.current === null) {
        cancelPointerRetarget();
        commitPointerHover(nextHover);
        return;
      }
      // Week columns can place another event directly in the pointer path to
      // the portaled card. Keep the current card stable during that crossing;
      // a genuine hover on the new event still takes over after a short pause.
      schedulePointerRetarget(nextHover);
    };
    const handleDocumentMouseMove = (moveEvent: MouseEvent) => {
      pointerPositionRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (!(moveEvent.target instanceof Element)) return;
      if (moveEvent.target.closest(WEEK_PREVIEW_POINTER_SURFACE_SELECTOR)) holdPointerHover();
    };
    const handlePointerWindowExit = () => clearPointerHover();
    const handleFocusIn = (focusEvent: FocusEvent) => {
      if (focusEvent.target instanceof HTMLElement && focusEvent.target.dataset.activityPreviewFocusSuppressed === "true") {
        delete focusEvent.target.dataset.activityPreviewFocusSuppressed;
        focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current, pointerLiftRef.current);
        setFocusHover(null);
        return;
      }
      const eventElement = eventElementFromTarget(focusEvent.target, bodyElement);
      focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current, pointerLiftRef.current);
      if (!eventElement) {
        setFocusHover(null);
        return;
      }
      const nextHover = hoverForElement(eventElement);
      if (!nextHover) return;
      focusLiftRef.current = liftEventElement(eventElement, pointerLiftRef.current);
      setFocusHover(nextHover);
    };
    const handleFocusOut = (focusEvent: FocusEvent) => {
      if (focusEvent.relatedTarget instanceof Element && focusEvent.relatedTarget.closest(".week-activity-inspector--preview")) return;
      const nextEventElement = eventElementFromTarget(focusEvent.relatedTarget, bodyElement);
      if (nextEventElement) return;
      focusLiftRef.current = dropLiftedEventElement(focusLiftRef.current, pointerLiftRef.current);
      setFocusHover(null);
    };

    bodyElement.addEventListener("mousemove", handleMouseMove);
    bodyElement.addEventListener("mouseleave", schedulePointerClear);
    bodyElement.addEventListener("focusin", handleFocusIn);
    bodyElement.addEventListener("focusout", handleFocusOut);
    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseleave", handlePointerWindowExit);
    window.addEventListener("blur", handlePointerWindowExit);
    return () => {
      bodyElement.removeEventListener("mousemove", handleMouseMove);
      bodyElement.removeEventListener("mouseleave", schedulePointerClear);
      bodyElement.removeEventListener("focusin", handleFocusIn);
      bodyElement.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseleave", handlePointerWindowExit);
      window.removeEventListener("blur", handlePointerWindowExit);
      dismissPreview();
    };
  }, [
    bodyElement,
    cancelPointerClear,
    cancelPointerRetarget,
    commitPointerHover,
    disabled,
    dismissPreview,
    holdPointerHover,
    schedulePointerClear,
    schedulePointerRetarget,
  ]);

  const hover = focusHover ?? pointerHover;
  const hoverEvent = hover
    ? buildWeekActivityInspectorEvent(hover.event, segmentsById, projectBySegmentId, projectsById)
    : null;
  const hoverSegments = hoverEvent?.segmentIds.flatMap((segmentId) => {
    const segment = segmentsById.get(segmentId);
    return segment ? [segment] : [];
  }) ?? [];
  const actionsDisabledReason = hoverEvent
    ? resolveActivityActionsDisabledReason(hoverEvent, hoverSegments, activityActionsEnabled, t)
    : null;
  return !disabled && hover ? (
    <ActivityInspectorPreview
      event={hoverEvent!}
      segments={hoverSegments}
      appIcons={appIcons}
      deviceLabelById={deviceLabelById}
      anchorElement={hover.anchorElement}
      descriptionTarget={hover.anchorElement.querySelector<HTMLElement>(".week-v2-calendar__event-open") ?? undefined}
      restoreFocusOnDismiss={focusHover !== null}
      actionsDisabledReason={actionsDisabledReason}
      classificationOptions={classificationOptions}
      projectOptions={projectOptions}
      canAssignProject={hasAssignProjectAction}
      canClassify={hasClassifyAction}
      onDismiss={dismissPreview}
      onOpenAttribute={onOpenActivity
        ? (field: ActivityInspectorAttribute) => {
            if (field === "project" ? !hasAssignProjectAction : !hasClassifyAction) return;
            onOpenActivity(hover.event, hover.anchorElement, field);
          }
        : undefined}
      onRequestDelete={hasDeleteAction && onOpenActivity
        ? () => onOpenActivity(hover.event, hover.anchorElement, "delete")
        : undefined}
      onPointerEnter={holdPointerHover}
      onPointerLeave={schedulePointerClear}
      onFocusEnter={holdPointerHover}
      onFocusLeave={clearFocusHover}
    />
  ) : null;
}
