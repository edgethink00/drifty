import { useCallback, useEffect, useRef, useState } from "react";
import { trackerClient } from "../../lib/api/trackerClient";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { CompanionPill } from "./CompanionPill";
import type {
  CompanionPillDismissReason,
  CompanionPillMomentEvent,
} from "./CompanionPillMoment";
import {
  recordCompanionEngagementMetric,
  type CompanionEngagementMetricKey,
} from "./companionEngagementMetrics";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import { toCompanionDriftAlarmMoment } from "./CompanionDriftAlarmCard";
import type { WatcherPeekEvent } from "./watcherPeekTypes";
import {
  COMPANION_PILL_SIZES,
  resolveCompanionHorizontalAnchor,
  type CompanionHorizontalAnchor,
  type CompanionPillState,
} from "./companionPillLayout";
import { openNativeCompanionPillMenu } from "./companionPillNativeMenu";
import { useLocalization } from "../localization/LocalizationContext";
import { resolveInitialDisplayLanguage } from "../localization/languagePreference";
import { translateFor } from "../localization/translate";
import { resolveDriftAlarmCopy, resolveInitialDriftAlarmCopyOverrides } from "./driftAlarmCopyStorage";
import {
  buildCompanionDayReviewPreview,
  buildCompanionDriftAlarmPreview,
  buildCompanionExtremeNudgePreview,
  buildCompanionMilestonePreview,
} from "./companionPillPreview";
import { reportEndOfDayReviewInteraction, useEndOfDayReviewDisplayedReporter } from "./useEndOfDayReviewDisplayedReporter";
import { companionMomentReferenceMs, COMPANION_MOMENT_STALE_AFTER_MS, isCompanionMomentStale } from "./companionMomentFreshness";
import { companionEventIdentity as companionMomentIdentity } from "./companionEventIdentity";
import { recordCompanionLifecycle } from "./companionLifecycleLog";
import {
  INFORMATIONAL_MOMENT_DEFER_RETRY_MS,
  isInformationalMomentKind,
  isInformationalMomentSuppressedNow,
  refreshInformationalMomentSuppression,
} from "./informationalMomentSuppression";
import {
  dismissNativeCompanionMoment,
  isTauriRuntime,
  listenToNativeCompanionPillClear,
  listenToNativeCompanionPillSnapshot,
  listenToNativeCompanionTransition,
  listenToNativeCompanionPointerExited,
  listenToNativeWatcherShow,
  presentPreparedNativeCompanionMoment,
  setNativeCompanionPillState,
  setNativeCompanionClickThrough,
  isNativeCompanionCursorOverCapsule,
  triggerNativeEndOfDayReviewAction,
  triggerNativeCompanionVisibilityAction,
  triggerNativeExtremeNudgeAction,
  type CompanionPillDriftAlarmPayload,
  type CompanionPillWindowEvent,
  type NativeCompanionTransitionEvent,
} from "./watcherBridge";

const COMPANION_THEME_STORAGE_KEY = "drifty.theme";
const COMPANION_DEFAULT_THEME = "light";
const COMPANION_MOMENT_QUEUE_GAP_MS = 700;

export function CompanionWindowApp() {
  const { t } = useLocalization();
  const [peekEvent, setPeekEvent] = useState<WatcherPeekEvent | null>(null);
  const [momentEvent, setMomentEvent] = useState<CompanionPillMomentEvent | null>(resolveDevelopmentPreviewMoment);
  /* Development previews start with a real moment instead of receiving one
     through the native bridge. Seed the imperative event ref from that same
     state so review links exercise the actual click and dismissal flow. */
  const momentEventRef = useRef<CompanionPillMomentEvent | null>(momentEvent);
  useEffect(() => {
    momentEventRef.current = momentEvent;
  }, [momentEvent]);
  /* The once-a-day review slot is marked only when this surface confirms an
     actual visible display; shipping the payload is not enough (see the
     reporter hook). */
  useEndOfDayReviewDisplayedReporter(
    momentEvent?.kind === "endOfDayReview" ? momentEvent : null,
  );
  const [isPointerInside, setIsPointerInside] = useState(false);
  const momentQueueRef = useRef<CompanionPillMomentEvent[]>([]);
  const momentQueueTimerRef = useRef<number | null>(null);
  const recordedMomentRef = useRef<string | null>(null);
  const [horizontalAnchor, setHorizontalAnchor] =
    useState<CompanionHorizontalAnchor>("center");
  const [nativeTransition, setNativeTransition] = useState<NativeCompanionTransitionEvent | null>(null);
  /* The surface needs the pill's own state so the milestone confetti gutter can
     be applied to the window, not just to the capsule. */
  const [pillState, setPillState] = useState<CompanionPillState>("collapsed");
  const [preparedMomentKey, setPreparedMomentKey] = useState<string | null>(null);
  const [presentedMomentKey, setPresentedMomentKey] = useState<string | null>(null);
  const [menuAnchorX, setMenuAnchorX] = useState<number | null>(null);
  const [usesDirectMenuEntry, setUsesDirectMenuEntry] = useState(false);
  const presentationModesRef = useRef(new WeakMap<CompanionPillMomentEvent, boolean>());
  const lastMomentKeyRef = useRef<string | undefined>(momentEvent ? companionMomentIdentity(momentEvent) : undefined);
  const preparedPresentationIdRef = useRef<number | undefined>(undefined);
  const stateRequestRef = useRef(0);

  const activateMoment = useCallback((nextMoment: CompanionPillMomentEvent | null) => {
    if (nextMoment && isCompanionMomentStale(nextMoment)) {
      recordCompanionLifecycle("expired_before_activation", companionMomentIdentity(nextMoment));
      return;
    }
    if (nextMoment && companionMomentIdentity(nextMoment) !== (momentEventRef.current && companionMomentIdentity(momentEventRef.current))) {
      lastMomentKeyRef.current = companionMomentIdentity(nextMoment);
      setUsesDirectMenuEntry(presentationModesRef.current.get(nextMoment) === true);
      setMenuAnchorX(null);
      setPreparedMomentKey(null);
      setPresentedMomentKey(null);
      preparedPresentationIdRef.current = undefined;
      recordCompanionLifecycle("accepted", companionMomentIdentity(nextMoment));
    }
    if (nextMoment && !momentEventRef.current) {
      setHorizontalAnchor(resolveCompanionAnchor(companionMomentState(nextMoment)));
    }
    momentEventRef.current = nextMoment;
    setMomentEvent(nextMoment);
  }, []);

  const enqueueMomentNow = useCallback((nextMoment: CompanionPillMomentEvent) => {
    const current = momentEventRef.current;
    const nextKey = companionMomentIdentity(nextMoment);
    if (current && companionMomentIdentity(current) === nextKey) {
      /* A correction acknowledgement replaces the decision in place, without
         collapsing the native panel or queuing a second card. */
      if (isDriftCorrectionMoment(current) && isDriftCorrectionMoment(nextMoment)
        && current.correctionStatus !== nextMoment.correctionStatus) {
        activateMoment(nextMoment);
      }
      return;
    }
    if (momentQueueRef.current.some((queued) => companionMomentIdentity(queued) === nextKey)) return;

    if (!current) {
      if (momentQueueTimerRef.current === null) {
        activateMoment(nextMoment);
        return;
      }
      if (isInterruptingMoment(nextMoment)) {
        window.clearTimeout(momentQueueTimerRef.current);
        momentQueueTimerRef.current = null;
        momentQueueRef.current = [];
        activateMoment(nextMoment);
        return;
      }
      momentQueueRef.current.push(nextMoment);
      return;
    }

    if (isInterruptingMoment(current)) {
      if (companionMomentPriority(nextMoment) > companionMomentPriority(current)) {
        momentQueueRef.current = [];
        recordCompanionEngagementMetric("moment_preempted");
        activateMoment(nextMoment);
      }
      /* While an intervention is active, lower-priority information is stale
         before it ever reaches the screen. Consume it instead of replaying it. */
      return;
    }

    if (isInterruptingMoment(nextMoment)) {
      /* The interrupted review or celebration is deliberately not requeued. */
      momentQueueRef.current = [];
      recordCompanionEngagementMetric("moment_preempted");
      activateMoment(nextMoment);
      return;
    }

    momentQueueRef.current.push(nextMoment);
  }, [activateMoment]);

  /* Informational moments never pop over a fullscreen app (a keynote, a
     film, a game): they wait in a side queue and retry once a minute until
     the fullscreen ends, and are consumed silently when they outlive their
     own freshness. Interventions bypass the gate entirely. */
  const deferredInformationalRef = useRef<CompanionPillMomentEvent[]>([]);
  const deferredInformationalTimerRef = useRef<number | null>(null);

  const flushDeferredInformationalMoments = useCallback(() => {
    void (async () => {
      await refreshInformationalMomentSuppression();
      const suppressed = isInformationalMomentSuppressedNow();
      const remaining: CompanionPillMomentEvent[] = [];
      for (const event of deferredInformationalRef.current) {
        if (isCompanionMomentStale(event)) continue;
        if (suppressed) {
          remaining.push(event);
          continue;
        }
        enqueueMomentNow(event);
      }
      deferredInformationalRef.current = remaining;
      if (remaining.length === 0 && deferredInformationalTimerRef.current !== null) {
        window.clearInterval(deferredInformationalTimerRef.current);
        deferredInformationalTimerRef.current = null;
      }
    })();
  }, [enqueueMomentNow]);

  useEffect(() => () => {
    if (deferredInformationalTimerRef.current !== null) {
      window.clearInterval(deferredInformationalTimerRef.current);
    }
  }, []);

  const enqueueMoment = useCallback((nextMoment: CompanionPillMomentEvent) => {
    if (isCompanionMomentStale(nextMoment)) {
      recordCompanionLifecycle("expired_on_receipt", companionMomentIdentity(nextMoment));
      return;
    }
    if (!isInformationalMomentKind(nextMoment.kind)) {
      enqueueMomentNow(nextMoment);
      return;
    }
    /* Never queue what is already stale; it would flash for a frame before
       the pill's own freshness check consumed it. */
    if (isCompanionMomentStale(nextMoment)) return;
    /* Keep the cache honest for the next read, then decide on the last known
       state so the show path stays synchronous. */
    void refreshInformationalMomentSuppression();
    if (!isInformationalMomentSuppressedNow()) {
      enqueueMomentNow(nextMoment);
      return;
    }
    const nextKey = companionMomentIdentity(nextMoment);
    if (deferredInformationalRef.current.some((queued) => companionMomentIdentity(queued) === nextKey)) return;
    deferredInformationalRef.current.push(nextMoment);
    if (deferredInformationalTimerRef.current === null) {
      deferredInformationalTimerRef.current = window.setInterval(
        flushDeferredInformationalMoments,
        INFORMATIONAL_MOMENT_DEFER_RETRY_MS,
      );
    }
  }, [enqueueMomentNow, flushDeferredInformationalMoments]);

  const finishCurrentMoment = useCallback((expectedKey?: string | null) => {
    const current = momentEventRef.current;
    if (expectedKey && (!current || companionMomentIdentity(current) !== expectedKey)) {
      recordCompanionLifecycle("obsolete_clear_ignored", expectedKey);
      return;
    }
    if (current) recordCompanionLifecycle("finished", companionMomentIdentity(current));
    activateMoment(null);
    if (momentQueueRef.current.length === 0 || momentQueueTimerRef.current !== null) return;
    momentQueueTimerRef.current = window.setTimeout(() => {
      momentQueueTimerRef.current = null;
      if (momentEventRef.current) return;
      let next = momentQueueRef.current.shift();
      while (next && isCompanionMomentStale(next)) {
        recordCompanionLifecycle("expired_in_queue", companionMomentIdentity(next));
        next = momentQueueRef.current.shift();
      }
      activateMoment(next ?? null);
    }, COMPANION_MOMENT_QUEUE_GAP_MS);
  }, [activateMoment]);

  useEffect(() => {
    if (!momentEvent) return;
    const identity = companionMomentIdentity(momentEvent);
    if (recordedMomentRef.current === identity) return;
    recordedMomentRef.current = identity;
    recordCompanionEngagementMetric(companionShownMetric(momentEvent));
  }, [momentEvent]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(COMPANION_THEME_STORAGE_KEY);
    const previewTheme = import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get("driftyCompanionTheme")
      : null;
    const theme = previewTheme === "light" || previewTheme === "dark"
      ? previewTheme
      : savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : COMPANION_DEFAULT_THEME;
    document.documentElement.dataset.surface = "companion";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      delete document.documentElement.dataset.surface;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = (promise: Promise<(() => void) | null>) => {
      void promise.then((unlisten) => {
        if (!unlisten) return;
        if (disposed) {
          cleanupTauriEventListener(unlisten);
          return;
        }
        unlisteners.push(unlisten);
      }).catch(ignoreCompanionBridgeRejection);
    };

    register(listenToNativeWatcherShow((nextEvent) => {
      if (isWatcherPeekEvent(nextEvent)) {
        setPeekEvent(nextEvent);
        return;
      }
      const nextMoment = toCompanionPillMoment(nextEvent);
      if (nextMoment) {
        /* Freeze the new card at the status-item origin in the same React
           commit that installs its content. Waiting for the asynchronous
           native resize response leaves one paint where the new card occupies
           the previous card's frame, which reads as a sideways slip. */
        presentationModesRef.current.set(nextMoment, nextEvent.__companionPresentation === "menuBar");
        enqueueMoment(nextMoment);
      }
    }));
    register(listenToNativeCompanionPillSnapshot(setPeekEvent));
    register(listenToNativeCompanionPillClear((momentKey) => {
      // A targeted clear also cancels a queued card; a deliberate whole-surface
      // clear must not resurrect the queue after the user hides Companion.
      momentQueueRef.current = momentKey
        ? momentQueueRef.current.filter((event) => companionMomentIdentity(event) !== momentKey)
        : [];
      deferredInformationalRef.current = momentKey
        ? deferredInformationalRef.current.filter((event) => companionMomentIdentity(event) !== momentKey)
        : [];
      if (!momentKey && momentQueueTimerRef.current !== null) {
        window.clearTimeout(momentQueueTimerRef.current);
        momentQueueTimerRef.current = null;
      }
      finishCurrentMoment(momentKey);
    }));
    register(listenToNativeCompanionTransition((event) => {
      setNativeTransition(event);
      setHorizontalAnchor(event.anchor);
    }));
    /* Hover state belongs to the capsule-accurate poll below, not to AppKit's
       tracking area. That area covers the whole panel, including the
       transparent gutter the capsule floats in — 88pt beside it and 64pt above
       and below it. Entered/moved therefore fired while the pointer was merely
       near the card, which paused the auto-dismiss countdown; and since the
       poll only writes on a change, it never cleared a pause it had not set.
       The card stayed frozen until the pointer left the entire window.

       Exit is still worth listening to: it is the one moment the panel can be
       certain no pointer is over it, so it restores the panel's ability to
       take the mouse without waiting for the next poll. */
    register(listenToNativeCompanionPointerExited(() => {
      ignoreCompanionBridgePromise(setNativeCompanionClickThrough(false));
    }));

    return () => {
      disposed = true;
      unlisteners.forEach(cleanupTauriEventListener);
      if (momentQueueTimerRef.current !== null) {
        window.clearTimeout(momentQueueTimerRef.current);
        momentQueueTimerRef.current = null;
      }
      momentQueueRef.current = [];
      momentEventRef.current = null;
    };
  }, [enqueueMoment, finishCurrentMoment]);


  const handleOpenDashboard = useCallback(() => {
    recordCompanionEngagementMetric("dashboard_opened");
    const current = momentEventRef.current;
    if (current?.kind === "endOfDayReview") reportEndOfDayReviewInteraction(current);
    ignoreCompanionBridgePromise(triggerNativeEndOfDayReviewAction("openDashboard", current ? companionMomentIdentity(current) : undefined));
  }, []);

  const handleOpenSettings = useCallback(() => {
    recordCompanionEngagementMetric("settings_opened");
    ignoreCompanionBridgePromise(triggerNativeEndOfDayReviewAction("openSettings", momentEventRef.current ? companionMomentIdentity(momentEventRef.current) : undefined));
  }, []);

  const handleOpenDayReviewAiSettings = useCallback(() => {
    const current = momentEventRef.current;
    if (current?.kind === "endOfDayReview") reportEndOfDayReviewInteraction(current);
    recordCompanionEngagementMetric("settings_opened");
    ignoreCompanionBridgePromise(triggerNativeEndOfDayReviewAction("openAiSettings", current ? companionMomentIdentity(current) : undefined));
  }, []);

  const handleOpenMilestoneDestination = useCallback((destination: "leaderboard" | "insights" | "dashboard") => {
    finishCurrentMoment();
    recordCompanionEngagementMetric(destination === "leaderboard"
      ? "leaderboard_opened"
      : destination === "insights"
        ? "trends_opened"
        : "dashboard_opened");
    const action = destination === "leaderboard"
      ? "openLeaderboard"
      : destination === "insights"
        ? "openTrends"
        : "openDashboard";
    ignoreCompanionBridgePromise(triggerNativeEndOfDayReviewAction(action, lastMomentKeyRef.current));
  }, [finishCurrentMoment]);

  const handleHideForOneHour = useCallback(() => {
    ignoreCompanionBridgePromise(triggerNativeCompanionVisibilityAction("hideOneHour"));
  }, []);

  const handleTurnOffCompanion = useCallback(() => {
    ignoreCompanionBridgePromise(triggerNativeCompanionVisibilityAction("turnOff"));
  }, []);

  const handleOpenMenu = useCallback(() => openNativeCompanionPillMenu({
    onOpenDashboard: handleOpenDashboard,
    onOpenSettings: handleOpenSettings,
    onHideForOneHour: handleHideForOneHour,
    onTurnOffCompanion: handleTurnOffCompanion,
  }, {
    openDashboard: t("companion.menu.openDashboard"),
    settings: t("companion.menu.settings"),
    hideForOneHour: t("companion.menu.hideOneHour"),
    turnOffCompanion: t("companion.menu.turnOff"),
  }), [handleHideForOneHour, handleOpenDashboard, handleOpenSettings, handleTurnOffCompanion, t]);

  const handleMomentAction = useCallback((action: DriftAlarmAction) => {
    if (action.type === "manual_correction") {
      const current = momentEventRef.current;
      if (current && isDriftCorrectionMoment(current)) {
        activateMoment({ ...current, correctionStatus: "acknowledged" });
      }
      recordCompanionEngagementMetric(companionActionMetric(action));
      ignoreCompanionBridgePromise(triggerNativeExtremeNudgeAction(action, lastMomentKeyRef.current));
      return;
    }
    finishCurrentMoment();
    recordCompanionEngagementMetric(companionActionMetric(action));
    ignoreCompanionBridgePromise(triggerNativeExtremeNudgeAction(action, lastMomentKeyRef.current));
  }, [activateMoment, finishCurrentMoment]);

  const handleDismiss = useCallback((reason: CompanionPillDismissReason) => {
    const kind = momentEvent?.kind;
    const key = momentEvent ? companionMomentIdentity(momentEvent) : null;
    if (!key || !momentEventRef.current || companionMomentIdentity(momentEventRef.current) !== key) return;
    recordCompanionLifecycle(`dismiss_${reason}`, key);
    /* A deliberate dismiss inside the reporter's dwell window still proves
       the card was seen; auto dismissals never do. */
    if (reason !== "auto" && kind === "endOfDayReview" && momentEvent?.kind === "endOfDayReview") {
      reportEndOfDayReviewInteraction(momentEvent);
    }
    finishCurrentMoment();
    recordCompanionEngagementMetric(reason === "auto" ? "moment_auto_dismissed" : "moment_dismissed");
    if (kind) {
      const dismissKind = momentEvent && isDriftCorrectionMoment(momentEvent)
        && momentEvent.correctionStatus === "acknowledged"
        ? "notDriftFeedback"
        : kind;
      ignoreCompanionBridgePromise(dismissNativeCompanionMoment(dismissKind, key));
    }
  }, [finishCurrentMoment, momentEvent]);

  const handleStateChange = useCallback((state: Parameters<typeof setNativeCompanionPillState>[0]) => {
    setPillState(state);
    if (state === "collapsed") {
      setPreparedMomentKey(null);
      setPresentedMomentKey(null);
      setMenuAnchorX(null);
      setUsesDirectMenuEntry(false);
    }
    const requested = momentEventRef.current;
    const requestedKey = requested ? companionMomentIdentity(requested) : lastMomentKeyRef.current;
    const referenceMs = requested ? companionMomentReferenceMs(requested) : null;
    const requestId = ++stateRequestRef.current;
    if (requested && isCompanionMomentStale(requested)) {
      finishCurrentMoment(requestedKey);
      return;
    }
    void setNativeCompanionPillState(state, requestedKey,
      referenceMs === null ? undefined : referenceMs + COMPANION_MOMENT_STALE_AFTER_MS,
    ).then((result) => {
      const current = momentEventRef.current;
      if (requestId !== stateRequestRef.current || !current
        || companionMomentIdentity(current) !== requestedKey || companionMomentState(current) !== state) return;
      if (isCompanionMomentStale(current)) {
        recordCompanionLifecycle("expired_after_prepare", requestedKey);
        finishCurrentMoment(requestedKey);
        return;
      }
      if (!result.prepared) {
        setUsesDirectMenuEntry(false);
        return;
      }
      preparedPresentationIdRef.current = result.presentationId ?? undefined;
      setMenuAnchorX(result.menuAnchorX);
      setPreparedMomentKey(requestedKey ?? null);
    }).catch(ignoreCompanionBridgeRejection);
  }, [finishCurrentMoment]);

  const currentMomentKey = momentEvent ? companionMomentIdentity(momentEvent) : null;
  const presentsMomentImmediately = currentMomentKey !== null && usesDirectMenuEntry;
  const preparedForDirectEntry = presentsMomentImmediately
    && preparedMomentKey === currentMomentKey;
  const directEntryAnimationReady = preparedForDirectEntry
    && presentedMomentKey === currentMomentKey;

  useEffect(() => {
    if (!preparedForDirectEntry) return;
    let cancelled = false;
    let warmupFrame = 0;
    let secondWarmupFrame = 0;
    let presentationFrame = 0;
    let warmupFallbackTimer = 0;
    let presentationFallbackTimer = 0;
    let presentationStarted = false;
    let presentationReleased = false;
    const preparedKey = currentMomentKey;
    const presentAfterWarmup = () => {
      if (cancelled || presentationStarted) return;
      presentationStarted = true;
      window.clearTimeout(warmupFallbackTimer);
      /* The hidden panel is now at its final native size and WebKit has had two
         presentation opportunities to allocate that backing store. Show the
         native panel in the frozen origin pose, then release shell and child
         animations together on its next visible frame. */
      const current = momentEventRef.current;
      if (!current || companionMomentIdentity(current) !== preparedKey) return;
      if (isCompanionMomentStale(current)) {
        recordCompanionLifecycle("expired_before_present", preparedKey);
        finishCurrentMoment(preparedKey);
        return;
      }
      void presentPreparedNativeCompanionMoment(preparedPresentationIdRef.current).then((shown) => {
        if (cancelled || !preparedKey) return;
        if (shown === false) {
          recordCompanionLifecycle("presentation_rejected", preparedKey);
          finishCurrentMoment(preparedKey);
          return;
        }
        recordCompanionLifecycle("presented", preparedKey);
        const releasePresentation = () => {
          if (cancelled || presentationReleased) return;
          presentationReleased = true;
          window.clearTimeout(presentationFallbackTimer);
          if (presentationFrame) window.cancelAnimationFrame(presentationFrame);
          const current = momentEventRef.current;
          if (!current || companionMomentIdentity(current) !== preparedKey) return;
          setPresentedMomentKey(preparedKey);
        };
        presentationFrame = window.requestAnimationFrame(releasePresentation);
        // Native show completion does not guarantee another rendering frame.
        // Keep a presented card from waiting indefinitely in its origin pose.
        presentationFallbackTimer = window.setTimeout(releasePresentation, 50);
      }).catch(ignoreCompanionBridgeRejection);
    };

    /* A passive effect runs after React's commit paint. Two additional hidden
       frames pre-warm WebKit's newly resized backing store and expensive card
       layers before AppKit orders the panel front. The timeout is only a
       safety net for macOS versions that throttle rAF on an ordered-out panel. */
    warmupFrame = window.requestAnimationFrame(() => {
      secondWarmupFrame = window.requestAnimationFrame(presentAfterWarmup);
    });
    warmupFallbackTimer = window.setTimeout(presentAfterWarmup, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(warmupFallbackTimer);
      window.clearTimeout(presentationFallbackTimer);
      if (warmupFrame) window.cancelAnimationFrame(warmupFrame);
      if (secondWarmupFrame) window.cancelAnimationFrame(secondWarmupFrame);
      if (presentationFrame) window.cancelAnimationFrame(presentationFrame);
    };
  }, [currentMomentKey, preparedForDirectEntry, finishCurrentMoment]);

  /* The fixed horizontal canvas keeps right-edge motion exact and leaves
     transparent room beside compact states. That rectangle must not swallow
     clicks meant for the desktop, so every state only takes the mouse while
     the cursor is actually over its visible capsule.

     This is polled rather than driven by pointer events because a click-through
     window stops reporting them, which would leave no way back. */
  useEffect(() => {
    let isCurrent = true;
    let wasOverCapsule: boolean | null = null;
    let timer: number | null = null;
    const sync = async () => {
      const overCapsule = await isNativeCompanionCursorOverCapsule();
      if (!isCurrent) return;
      if (overCapsule !== wasOverCapsule) {
        wasOverCapsule = overCapsule;
        setIsPointerInside(overCapsule);
        ignoreCompanionBridgePromise(setNativeCompanionClickThrough(!overCapsule));
      }
      // Wait for the native query to settle before scheduling the next one. A
      // fixed interval can otherwise queue bridge calls faster than Tauri
      // answers them, and late responses may apply cursor state out of order.
      timer = window.setTimeout(() => void sync(), 32);
    };

    void sync();
    return () => {
      isCurrent = false;
      if (timer !== null) window.clearTimeout(timer);
      ignoreCompanionBridgePromise(setNativeCompanionClickThrough(false));
    };
  }, [pillState]);

  const handleToggleTracking = useCallback(() => {
    const wasPaused = peekEvent?.trackingPaused === true;
    setPeekEvent((current) => current ? { ...current, trackingPaused: !wasPaused } : current);
    void (async () => {
      try {
        const status = await trackerClient.getStatus();
        const nextStatus = status.running ? await trackerClient.stop() : await trackerClient.start();
        setPeekEvent((current) => current ? { ...current, trackingPaused: nextStatus?.running !== true } : current);
      } catch {
        setPeekEvent((current) => current ? { ...current, trackingPaused: wasPaused } : current);
      }
    })();
  }, [peekEvent?.trackingPaused]);

  return (
    <main
      className="watcher-window-surface companion-pill-surface"
      data-state={pillState}
      data-preview={isDevelopmentPreview() ? "true" : undefined}
      aria-label="Drifty companion pill"
    >
      <CompanionPill
        peekEvent={peekEvent}
        momentEvent={momentEvent}
        anchor={horizontalAnchor}
        nativeTransition={nativeTransition}
        usesNativeTransitionPhases={isTauriRuntime()}
        presentsMomentImmediately={presentsMomentImmediately}
        directEntryAnimationReady={directEntryAnimationReady}
        menuAnchorX={menuAnchorX}
        isPointerInside={isPointerInside}
        isTrackingPaused={peekEvent?.trackingPaused === true}
        onDismissMoment={handleDismiss}
        onOpenDashboard={handleOpenDashboard}
        onOpenDayReviewAiSettings={handleOpenDayReviewAiSettings}
        onOpenMilestoneDestination={handleOpenMilestoneDestination}
        onOpenSettings={handleOpenSettings}
        onOpenMenu={handleOpenMenu}
        onToggleTracking={handleToggleTracking}
        onMomentAction={handleMomentAction}
        onStateChange={handleStateChange}
      />
    </main>
  );
}

function isWatcherPeekEvent(event: CompanionPillWindowEvent): event is WatcherPeekEvent {
  return !("kind" in event);
}

function resolveCompanionAnchor(targetState: CompanionPillState): CompanionHorizontalAnchor {
  /* WKWebView reports screenX/outerWidth as zero for this non-activating
     transparent NSPanel. Its production default is top-right, and the native
     started event replaces this fallback with the measured anchor before any
     subsequent transition. Treating the zero tuple as a real left edge caused
     the first opening frame to pin left before snapping right. */
  if (window.outerWidth <= 0) return "right";
  const screenWithOffset = window.screen as Screen & { availLeft?: number };
  const availableLeft = Number.isFinite(screenWithOffset.availLeft)
    ? screenWithOffset.availLeft ?? 0
    : 0;
  const availableWidth = window.screen.availWidth || window.screen.width;
  return resolveCompanionHorizontalAnchor({
    capsuleCenterX: window.screenX + window.outerWidth / 2,
    targetCapsuleWidth: COMPANION_PILL_SIZES[targetState].width,
    screenLeft: availableLeft,
    screenWidth: availableWidth,
  });
}

function companionMomentState(event: CompanionPillMomentEvent): CompanionPillState {
  if (event.kind === "endOfDayReview") {
    if (event.assessment?.state === "pending") return "eodPending";
    if (event.layout === "full") return "eod";
    return event.layout === "compact" ? "eodCompact" : "eodMinimal";
  }
  if (event.kind === "extremeNudgeToast") return "nudge";
  if (event.kind === "milestone") return "milestone";
  return "drift";
}

function isCompanionDriftAlarmEvent(
  event: CompanionPillWindowEvent,
): event is CompanionPillDriftAlarmPayload {
  return "kind" in event && event.kind === "companionDriftAlarm";
}

function toCompanionPillMoment(event: CompanionPillWindowEvent): CompanionPillMomentEvent | null {
  if ("kind" in event && event.kind === "endOfDayReview") return event;
  if ("kind" in event && event.kind === "extremeNudgeToast") return event;
  if ("kind" in event && event.kind === "milestone") return event;
  if (isCompanionDriftAlarmEvent(event)) {
    return toCompanionDriftAlarmMoment(event.alarm);
  }
  return null;
}

function companionMomentPriority(event: CompanionPillMomentEvent): number {
  if (event.kind === "extremeNudgeToast") return 4;
  if (event.kind === "driftAlarm") return 3;
  if (event.kind === "endOfDayReview") return 2;
  return 1;
}

function isInterruptingMoment(event: CompanionPillMomentEvent): boolean {
  return event.kind === "extremeNudgeToast" || event.kind === "driftAlarm";
}

function companionShownMetric(event: CompanionPillMomentEvent): CompanionEngagementMetricKey {
  if (event.kind === "milestone") return "milestone_shown";
  if (event.kind === "driftAlarm") return "drift_alarm_shown";
  if (event.kind === "extremeNudgeToast") return "extreme_nudge_shown";
  return "day_review_shown";
}

function companionActionMetric(action: DriftAlarmAction): CompanionEngagementMetricKey {
  if (action.type === "settings") return "settings_opened";
  return action.type;
}

function isDriftCorrectionMoment(
  event: CompanionPillMomentEvent,
): event is Extract<CompanionPillMomentEvent, { kind: "driftAlarm" | "extremeNudgeToast" }> {
  return event.kind === "driftAlarm" || event.kind === "extremeNudgeToast";
}

function ignoreCompanionBridgePromise(promise: Promise<unknown>) {
  void promise.catch(ignoreCompanionBridgeRejection);
}

function ignoreCompanionBridgeRejection() {
  return undefined;
}

function resolveDevelopmentPreviewMoment(): CompanionPillMomentEvent | null {
  const preview = isDevelopmentPreview();
  const correctionStatus = resolveDevelopmentCorrectionStatus();
  // Browser previews read the same wording the main window would send, so a
  // Korean review shows Korean cards.
  const language = resolveInitialDisplayLanguage();
  const copy = { language, copySettings: resolveDriftAlarmCopy(resolveInitialDriftAlarmCopyOverrides(), language) };
  if (preview === "drift-alarm") {
    return {
      ...toCompanionDriftAlarmMoment(buildCompanionDriftAlarmPreview("drift-alarm", Date.now(), false, copy)),
      correctionStatus,
    };
  }
  if (preview === "break-return") {
    return toCompanionDriftAlarmMoment(buildCompanionDriftAlarmPreview("break-return", Date.now(), false, copy));
  }
  if (preview === "extreme-nudge") return buildCompanionExtremeNudgePreview(Date.now(), copy);
  if (preview === "milestone") return buildCompanionMilestonePreview("record-30d", Date.now(), translateFor(language));
  if (preview === "dayReview") return buildCompanionDayReviewPreview();
  return null;
}

function resolveDevelopmentCorrectionStatus() {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("driftyCompanionCorrection");
  return value === "acknowledged" ? value : undefined;
}

function isDevelopmentPreview(): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("driftyCompanionPreview");
}
