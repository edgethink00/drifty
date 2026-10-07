import { useCallback, useEffect, useRef, useState, type AnimationEvent, type FocusEvent } from "react";

/** The five-second, hover/focus-paused lifecycle used by app floating notices. */
export function useFloatingNotice(onDismiss: () => void, durationMs = 5_000) {
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [hasEntered, setHasEntered] = useState(isNoticeMotionReduced);
  const [isLeaving, setIsLeaving] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);
  const dismissedRef = useRef(false);
  const leavingRef = useRef(false);
  const isTimerPausedRef = useRef(false);
  const timeoutIdRef = useRef<number | null>(null);
  const timerStartedAtRef = useRef(performance.now());
  const remainingDismissMsRef = useRef(durationMs);
  const pauseSourcesRef = useRef({ hover: false, focus: false });

  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  const clearDismissTimer = useCallback(() => {
    if (timeoutIdRef.current === null) return;
    window.clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = null;
  }, []);

  const finishDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearDismissTimer();
    dismissRef.current();
  }, [clearDismissTimer]);

  const requestLeave = useCallback(() => {
    if (leavingRef.current || dismissedRef.current) return;
    leavingRef.current = true;
    clearDismissTimer();
    if (isNoticeMotionReduced()) { finishDismiss(); return; }
    setIsLeaving(true);
  }, [clearDismissTimer, finishDismiss]);

  const setPauseSource = useCallback((source: "hover" | "focus", active: boolean) => {
    pauseSourcesRef.current = { ...pauseSourcesRef.current, [source]: active };
    if (leavingRef.current) return;
    const paused = pauseSourcesRef.current.hover || pauseSourcesRef.current.focus;
    if (paused === isTimerPausedRef.current) return;
    isTimerPausedRef.current = paused;
    if (paused) {
      clearDismissTimer();
      remainingDismissMsRef.current = Math.max(0, remainingDismissMsRef.current - (performance.now() - timerStartedAtRef.current));
    }
    setIsTimerPaused(paused);
  }, [clearDismissTimer]);

  useEffect(() => {
    if (isTimerPaused || isLeaving) return undefined;
    timerStartedAtRef.current = performance.now();
    timeoutIdRef.current = window.setTimeout(requestLeave, remainingDismissMsRef.current);
    return clearDismissTimer;
  }, [clearDismissTimer, isLeaving, isTimerPaused, requestLeave]);

  useEffect(() => {
    if (!isLeaving) return undefined;
    const timer = window.setTimeout(finishDismiss, leaveFallbackMs(rootRef.current));
    return () => window.clearTimeout(timer);
  }, [finishDismiss, isLeaving]);

  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName === "floating-notice-enter") setHasEntered(true);
    if (event.animationName === "floating-notice-leave") finishDismiss();
  }, [finishDismiss]);

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (!document.hasFocus()) return;
    setPauseSource("focus", false);
  }, [setPauseSource]);

  return {
    rootRef, hasEntered, isLeaving, isTimerPaused, requestLeave,
    handlers: {
      onAnimationEnd,
      onMouseEnter: () => setPauseSource("hover", true),
      onMouseLeave: () => setPauseSource("hover", false),
      onFocus: () => setPauseSource("focus", true),
      onBlur,
    },
  };
}

function isNoticeMotionReduced(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function leaveFallbackMs(root: HTMLElement | null): number {
  if (!root) return 220;
  const style = window.getComputedStyle(root);
  const milliseconds = (value: string) => value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
  const durations = style.animationDuration.split(",").map(milliseconds);
  const delays = style.animationDelay.split(",").map(milliseconds);
  const longest = Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] || 0)).filter(Number.isFinite));
  return style.animationDuration ? longest + 80 : 220;
}
