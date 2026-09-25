import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "../localization/LocalizationContext";
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
  type PostOnboardingSidebarGuideStep,
} from "./postOnboardingSidebarGuide";
import "./post-onboarding-sidebar-guide.css";

type GuideRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

type GuideLayout = {
  readonly anchor: GuideRect;
  readonly highlightPadding?: number;
  readonly highlightRadius?: string;
  readonly panelLeft: number;
  readonly panelTop: number;
};

const VIEWPORT_MARGIN = 14;
const PANEL_GAP = 14;
const PANEL_WIDTH = 296;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function resolveAnchor(step: PostOnboardingSidebarGuideStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-sidebar-guide-anchor="${step}"]`);
}

function toGuideRect(element: HTMLElement): GuideRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function computePostOnboardingSidebarGuideLayout({
  anchor,
  panelHeight,
  viewportWidth,
  viewportHeight,
  keepClear = null,
}: {
  readonly anchor: GuideRect;
  readonly panelHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** A region the panel must not cover, such as the day's headline. */
  readonly keepClear?: GuideRect | null;
}): GuideLayout {
  const panelLeft = clamp(
    anchor.right + PANEL_GAP,
    VIEWPORT_MARGIN,
    viewportWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
  );
  const centeredTop = anchor.top + anchor.height / 2 - panelHeight / 2;
  let panelTop = clamp(centeredTop, VIEWPORT_MARGIN, viewportHeight - panelHeight - VIEWPORT_MARGIN);
  if (keepClear) {
    const overlapsHorizontally = panelLeft < keepClear.right && panelLeft + PANEL_WIDTH > keepClear.left;
    const overlapsVertically = panelTop < keepClear.bottom && panelTop + panelHeight > keepClear.top;
    if (overlapsHorizontally && overlapsVertically) {
      panelTop = clamp(keepClear.bottom + PANEL_GAP, VIEWPORT_MARGIN, viewportHeight - panelHeight - VIEWPORT_MARGIN);
    }
  }
  return { anchor, panelLeft, panelTop };
}

/** The user's own result: the guide may dim it but must never sit on top of it. */
function resolveKeepClearRect(): GuideRect | null {
  const headline = document.querySelector<HTMLElement>(".dashboard-page-head__summary");
  if (!headline) return null;
  const rect = toGuideRect(headline);
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function copyKeys(step: PostOnboardingSidebarGuideStep, navigationRefreshEnabled: boolean) {
  if (navigationRefreshEnabled && step === "activity") {
    return {
      section: "postOnboarding.sidebarGuide.refreshActivitySection",
      title: "postOnboarding.sidebarGuide.refreshActivityTitle",
      body: "postOnboarding.sidebarGuide.refreshActivityBody",
    } as const;
  }
  return {
    section: `postOnboarding.sidebarGuide.${step}Section`,
    title: `postOnboarding.sidebarGuide.${step}Title`,
    body: `postOnboarding.sidebarGuide.${step}Body`,
  } as const;
}

type GuideProps = {
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  readonly onDismiss: () => void;
  readonly navigationRefreshEnabled?: boolean;
};

/** Matches the app's anchored-popup exit: a short, accelerating fade. */
const GUIDE_EXIT_MS = 120;
/** Long enough for the 240ms glide between steps to finish. */
const GUIDE_MOVE_MS = 320;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Keep this mounted and pass `step={null}` to close: the guide then fades out
 * like the app's other anchored popups instead of vanishing mid-frame.
 */
export function PostOnboardingSidebarGuide({
  step,
  ...props
}: GuideProps & { readonly step: PostOnboardingSidebarGuideStep | null }) {
  const [shownStep, setShownStep] = useState(step);
  const [exiting, setExiting] = useState(false);
  const hasShownRef = useRef(step !== null);

  useLayoutEffect(() => {
    if (step) {
      hasShownRef.current = true;
      setShownStep(step);
      setExiting(false);
      return undefined;
    }
    if (!hasShownRef.current) return undefined;
    const settle = () => {
      hasShownRef.current = false;
      setShownStep(null);
      setExiting(false);
    };
    if (prefersReducedMotion()) {
      settle();
      return undefined;
    }
    setExiting(true);
    const timeout = window.setTimeout(settle, GUIDE_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [step]);

  if (!shownStep) return null;
  return <GuideLayer {...props} step={shownStep} exiting={exiting} />;
}

function GuideLayer({
  step,
  exiting,
  onAdvance,
  onBack,
  onDismiss,
  navigationRefreshEnabled = false,
}: GuideProps & { readonly step: PostOnboardingSidebarGuideStep; readonly exiting: boolean }) {
  const { t } = useLocalization();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<GuideLayout | null>(null);
  // A click on the dimmed area is blocked; answer it by nudging the panel so
  // the app never feels frozen and the eye goes back to the guide.
  const [nudging, setNudging] = useState(false);
  // Timed rather than tied to animationend: with reduced motion there is no
  // animation, and the outline shown instead must still clear itself.
  useEffect(() => {
    if (!nudging) return undefined;
    const timeout = window.setTimeout(() => setNudging(false), 420);
    return () => window.clearTimeout(timeout);
  }, [nudging]);
  const stepIndex = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.indexOf(step);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.length - 1;
  const keys = copyKeys(step, navigationRefreshEnabled);

  // Between steps the panel and the lit section glide to their next place
  // instead of blinking; outside a step change they track the anchor at once.
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const previousStepRef = useRef(step);
  useLayoutEffect(() => {
    if (previousStepRef.current === step) return undefined;
    previousStepRef.current = step;
    movingRef.current = true;
    setMoving(true);
    const timeout = window.setTimeout(() => {
      movingRef.current = false;
      setMoving(false);
    }, GUIDE_MOVE_MS);
    return () => window.clearTimeout(timeout);
  }, [step]);

  // A closing guide leaves the focus and accessibility trees at once, even
  // while its pixels are still fading. React's DOM types have no `inert` prop.
  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.inert = exiting;
  }, [exiting]);

  useEffect(() => {
    if (exiting) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exiting, onDismiss]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    let frame = 0;
    let observedAnchor: HTMLElement | null = null;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => update());

    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const anchorElement = resolveAnchor(step);
        if (!anchorElement) {
          if (resizeObserver && observedAnchor) resizeObserver.unobserve(observedAnchor);
          observedAnchor = null;
          // The next step's anchor can mount a frame late (the account menu
          // opens on the same step change). Hold the previous place while the
          // glide runs; the DOM observer retries as soon as it appears.
          if (movingRef.current) return;
          setLayout(null);
          return;
        }
        if (observedAnchor !== anchorElement) {
          if (resizeObserver && observedAnchor) resizeObserver.unobserve(observedAnchor);
          observedAnchor = anchorElement;
          resizeObserver?.observe(anchorElement);
        }
        const anchor = toGuideRect(anchorElement);
        if (anchor.width <= 0 || anchor.height <= 0) {
          setLayout(null);
          return;
        }
        // Keep the complete ring visible without changing its shape at one edge.
        const highlightPadding = Math.max(0, Math.min(5,
          anchor.left - 1, anchor.top - 1,
          window.innerWidth - anchor.right - 1, window.innerHeight - anchor.bottom - 1,
        ));
        const radius = Number.parseFloat(window.getComputedStyle(anchorElement).borderTopLeftRadius) || 0;
        setLayout({
          ...computePostOnboardingSidebarGuideLayout({
            anchor,
            panelHeight: panel.offsetHeight || 184,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            keepClear: resolveKeepClearRect(),
          }),
          highlightPadding,
          highlightRadius: `${radius + highlightPadding}px`,
        });
        // ResizeObserver does not report transforms during the menu's entrance.
        if (anchorElement.getAnimations?.().some((animation) => animation.playState === "running")) update();
      });
    };

    // Unrelated buttons and charts must not trigger layout work for this guide.
    const updateForAnchorMotion = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = resolveAnchor(step);
      if (anchor && (target === anchor || target.contains(anchor))) update();
    };
    const motionEvents = ["transitionrun", "transitionend", "transitioncancel",
      "animationstart", "animationend", "animationcancel"] as const;

    update();
    resizeObserver?.observe(panel);
    mutationObserver?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    motionEvents.forEach((name) => document.addEventListener(name, updateForAnchorMotion, true));
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      motionEvents.forEach((name) => document.removeEventListener(name, updateForAnchorMotion, true));
    };
  }, [step]);

  // The scrim takes clicks outside the highlighted section, so keyboard users
  // need to land on the guide. Focus goes to the panel itself: that puts the
  // guide first in the tab order without drawing a focus ring on a button for
  // someone who arrived by mouse. A hidden guide cannot take focus, so wait
  // for its first placement.
  const positioned = layout !== null;
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!positioned || focusedRef.current) return undefined;
    focusedRef.current = true;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [positioned]);

  const style = layout ? {
    "--sidebar-guide-highlight-padding": `${layout.highlightPadding ?? 5}px`,
    "--sidebar-guide-highlight-radius": layout.highlightRadius,
    "--sidebar-guide-anchor-left": `${layout.anchor.left}px`,
    "--sidebar-guide-anchor-top": `${layout.anchor.top}px`,
    "--sidebar-guide-anchor-right": `${layout.anchor.right}px`,
    "--sidebar-guide-anchor-bottom": `${layout.anchor.bottom}px`,
    "--sidebar-guide-anchor-width": `${layout.anchor.width}px`,
    "--sidebar-guide-anchor-height": `${layout.anchor.height}px`,
    "--sidebar-guide-panel-left": `${layout.panelLeft}px`,
    "--sidebar-guide-panel-top": `${layout.panelTop}px`,
  } as CSSProperties : undefined;

  return createPortal(
    <div
      ref={rootRef}
      className={`post-onboarding-sidebar-guide${layout ? " post-onboarding-sidebar-guide--positioned" : ""}`}
      data-step={step}
      data-phase={exiting ? "exiting" : "open"}
      data-moving={moving || undefined}
      style={style}
    >
      {layout ? (
        <>
          {(["top", "left", "right", "bottom"] as const).map((edge) => (
            <span
              key={edge}
              className="post-onboarding-sidebar-guide__scrim"
              data-edge={edge}
              aria-hidden="true"
              onPointerDown={(event) => {
                event.preventDefault();
                setNudging(true);
              }}
            />
          ))}
          <span className="post-onboarding-sidebar-guide__highlight" aria-hidden="true" />
          {/* The dim takes clicks, and on macOS it covers the hidden-title
              window chrome. This strip keeps the window movable (drag, and
              double-click to zoom) while the chrome's own buttons stay
              covered, matching the onboarding window's drag strip. */}
          <span className="post-onboarding-sidebar-guide__drag-strip" data-tauri-drag-region aria-hidden="true" />
        </>
      ) : null}
      <aside
        ref={panelRef}
        className={`post-onboarding-sidebar-guide__panel${nudging ? " post-onboarding-sidebar-guide__panel--nudge" : ""}`}
        role="region"
        tabIndex={-1}
        aria-labelledby="post-onboarding-sidebar-guide-title"
        aria-describedby="post-onboarding-sidebar-guide-body"
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
          const onPanel = event.target === event.currentTarget;
          if (event.key === "ArrowRight" || (onPanel && event.key === "Enter")) {
            event.preventDefault();
            onAdvance();
          } else if (event.key === "ArrowLeft" && !isFirst) {
            event.preventDefault();
            onBack();
          }
        }}
      >
        <button
          type="button"
          className="post-onboarding-sidebar-guide__close"
          aria-label={t("postOnboarding.sidebarGuide.close")}
          title={t("postOnboarding.sidebarGuide.close")}
          onClick={onDismiss}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>

        <div className="post-onboarding-sidebar-guide__meta" key={`meta-${step}`}>
          <span>{t(keys.section)}</span>
          <span aria-hidden="true">·</span>
          <span>
            <span aria-hidden="true">{stepIndex + 1} / {POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.length}</span>
            <span className="post-onboarding-sidebar-guide__sr-only">
              {t("postOnboarding.sidebarGuide.progress", {
                current: stepIndex + 1,
                total: POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.length,
              })}
            </span>
          </span>
        </div>
        <div className="post-onboarding-sidebar-guide__copy" role="status" aria-live="polite" aria-atomic="true">
          <div className="post-onboarding-sidebar-guide__copy-inner" key={step}>
            <strong id="post-onboarding-sidebar-guide-title">{t(keys.title)}</strong>
            <p id="post-onboarding-sidebar-guide-body">{t(keys.body)}</p>
          </div>
        </div>

        <div className="post-onboarding-sidebar-guide__footer">
          <button type="button" className="app-btn app-btn--quiet" onClick={onDismiss}>
            {t("postOnboarding.sidebarGuide.skip")}
          </button>
          <div className="post-onboarding-sidebar-guide__actions">
            {!isFirst ? (
              <button type="button" className="app-btn app-btn--secondary" onClick={onBack}>
                {t("postOnboarding.sidebarGuide.back")}
              </button>
            ) : null}
            <button type="button" className="app-btn app-btn--primary" onClick={onAdvance}>
              {t(isLast ? "postOnboarding.sidebarGuide.finish" : "postOnboarding.sidebarGuide.next")}
            </button>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
