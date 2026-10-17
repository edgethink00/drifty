import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, AppIconMap, ClassificationOptions } from "@drifty/domain";
import {
  ActivityInspectorPreview,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorProjectOption,
} from "./WeekActivityInspector";
import {
  ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS,
  readAnchoredPreviewCardRect,
  trackAnchoredHoverIntent,
  type AnchoredHoverIntent,
} from "../../components/anchoredCardPosition";
import type { WeekCalendarEvent } from "./weekCalendar";
import { buildWeekActivityInspectorEvent } from "./weekActivityInspectorEvent";
import { useLocalization } from "../localization/LocalizationContext";
import { useActivityLabels } from "../activity-labels/ActivityLabelsContext";
import { activityLabelForWeekEvent, type ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";

const HOVERED_WEEK_CALENDAR_EVENT_Z_INDEX = "29";
// Retargeting only waits long enough for the current portal geometry to settle.
// The longer shared delay remains reserved for crossing empty space into a card.
const WEEK_HOVER_RETARGET_SETTLE_DELAY_MS = 16;
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
  readonly disabled?: boolean;
  /** With timeline cards: each drawn block's name, by event id (weekCardBlocks.ts). */
  readonly cardLabels?: ReadonlyMap<string, ActivityInspectorLabel | null>;
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
// its preview after the pointer leaves. Once the pointer leaves a block, its
// travel decides the card's fate: closing in on the card keeps it (with the
// shared delay as a cap), while moving anywhere else dismisses it right away.
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
  disabled = false,
  cardLabels,
}: WeekCalendarHoverLayerProps) {
  const { t } = useLocalization();
  const activityLabels = useActivityLabels();
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
  const pointerClearIntentRef = useRef<AnchoredHoverIntent | null>(null);

  const isPointerInsideCurrentPreview = useCallback(() => {
    const pointerPosition = pointerPositionRef.current;
    if (!pointerPosition) return false;
    const rect = readAnchoredPreviewCardRect();
    return rect !== null
      && pointerPosition.x >= rect.left
      && pointerPosition.x <= rect.right
      && pointerPosition.y >= rect.top
      && pointerPosition.y <= rect.bottom;
  }, []);

  const cancelPointerClear = useCallback(() => {
    pointerClearIntentRef.current = null;
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
    // Measure travel from where the pointer last was, so the first sample
    // outside the block already counts toward abandoning the card.
    const origin = pointerPositionRef.current;
    const cardRect = origin && pointerEventIdRef.current !== null ? readAnchoredPreviewCardRect() : null;
    pointerClearIntentRef.current = origin && cardRect
      ? trackAnchoredHoverIntent(null, origin.x, origin.y, cardRect).intent
      : null;
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      pointerClearIntentRef.current = null;
      if (isPointerInsideCurrentPreview()) return;
      clearPointerHover();
    }, ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS);
  }, [cancelPointerRetarget, clearPointerHover, isPointerInsideCurrentPreview]);

  const trackPointerClearIntent = useCallback((x: number, y: number) => {
    if (clearTimerRef.current === null || pointerEventIdRef.current === null) return;
    const cardRect = readAnchoredPreviewCardRect();
    if (!cardRect) return;
    const step = trackAnchoredHoverIntent(pointerClearIntentRef.current, x, y, cardRect);
    pointerClearIntentRef.current = step.intent;
    if (step.verdict === "abandoned") clearPointerHover();
  }, [clearPointerHover]);

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
      commitPointerHover(pendingHover);
    }, WEEK_HOVER_RETARGET_SETTLE_DELAY_MS);
  }, [cancelPointerClear, cancelPointerRetarget, commitPointerHover]);

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
      // The read-only card passes input through. The underlying activity
      // always wins, including cells visually beneath the preview.
      schedulePointerRetarget(nextHover);
    };
    const handleDocumentMouseMove = (moveEvent: MouseEvent) => {
      pointerPositionRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (!eventElementFromTarget(moveEvent.target, bodyElement) && isPointerInsideCurrentPreview()) {
        // Reading the preview over empty space must not require a precise
        // pointer position, but it never blocks selecting another activity.
        cancelPointerClear();
        return;
      }
      if (!bodyElement.contains(moveEvent.target as Node) && pointerEventIdRef.current !== null) schedulePointerClear();
      trackPointerClearIntent(moveEvent.clientX, moveEvent.clientY);
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
    isPointerInsideCurrentPreview,
    schedulePointerClear,
    schedulePointerRetarget,
    trackPointerClearIntent,
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
  const hoverLabel = hover
    ? cardLabels?.has(hover.event.id)
      ? cardLabels.get(hover.event.id) ?? null
      : activityLabelForWeekEvent(
        activityLabels,
        hover.anchorElement.closest<HTMLElement>(".week-v2-calendar__day-column")?.dataset.weekDay,
        hover.event.segmentIds,
        hover.event,
      )
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
      activityLabel={hoverLabel}
      onDismiss={dismissPreview}
    />
  ) : null;
}
