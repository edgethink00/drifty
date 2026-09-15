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
}: {
  readonly anchor: GuideRect;
  readonly panelHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): GuideLayout {
  const panelLeft = clamp(
    anchor.right + PANEL_GAP,
    VIEWPORT_MARGIN,
    viewportWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
  );
  const centeredTop = anchor.top + anchor.height / 2 - panelHeight / 2;
  const panelTop = clamp(centeredTop, VIEWPORT_MARGIN, viewportHeight - panelHeight - VIEWPORT_MARGIN);
  return { anchor, panelLeft, panelTop };
}

function copyKeys(step: PostOnboardingSidebarGuideStep, navigationRefreshEnabled: boolean) {
  if (navigationRefreshEnabled && (step === "dashboard" || step === "activity")) {
    const capitalizedStep = step === "dashboard" ? "Dashboard" : "Activity";
    return {
      section: `postOnboarding.sidebarGuide.refresh${capitalizedStep}Section`,
      title: `postOnboarding.sidebarGuide.refresh${capitalizedStep}Title`,
      body: `postOnboarding.sidebarGuide.refresh${capitalizedStep}Body`,
    } as const;
  }
  return {
    section: `postOnboarding.sidebarGuide.${step}Section`,
    title: `postOnboarding.sidebarGuide.${step}Title`,
    body: `postOnboarding.sidebarGuide.${step}Body`,
  } as const;
}

export function PostOnboardingSidebarGuide({
  step,
  onAdvance,
  onBack,
  onDismiss,
  navigationRefreshEnabled = false,
}: {
  readonly step: PostOnboardingSidebarGuideStep;
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  readonly onDismiss: () => void;
  readonly navigationRefreshEnabled?: boolean;
}) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<GuideLayout | null>(null);
  const stepIndex = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.indexOf(step);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.length - 1;
  const keys = copyKeys(step, navigationRefreshEnabled);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    setLayout(null);
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
      className={`post-onboarding-sidebar-guide${layout ? " post-onboarding-sidebar-guide--positioned" : ""}`}
      data-step={step}
      style={style}
    >
      {layout ? (
        <>
          <span className="post-onboarding-sidebar-guide__scrim" data-edge="top" aria-hidden="true" />
          <span className="post-onboarding-sidebar-guide__scrim" data-edge="left" aria-hidden="true" />
          <span className="post-onboarding-sidebar-guide__scrim" data-edge="right" aria-hidden="true" />
          <span className="post-onboarding-sidebar-guide__scrim" data-edge="bottom" aria-hidden="true" />
          <span className="post-onboarding-sidebar-guide__highlight" aria-hidden="true" />
        </>
      ) : null}
      <aside
        ref={panelRef}
        className="post-onboarding-sidebar-guide__panel"
        role="region"
        aria-labelledby="post-onboarding-sidebar-guide-title"
        aria-describedby="post-onboarding-sidebar-guide-body"
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

        <div className="post-onboarding-sidebar-guide__meta">
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
          <strong id="post-onboarding-sidebar-guide-title">{t(keys.title)}</strong>
          <p id="post-onboarding-sidebar-guide-body">{t(keys.body)}</p>
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
