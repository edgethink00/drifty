import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { GuidePhrases } from "./guideLineBreaks";
import type { TranslationKey } from "../localization/translations";
import { POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, type PostOnboardingSidebarGuideStep } from "./postOnboardingSidebarGuide";
import { NarrativeGuideIllustration } from "./components/NarrativeGuideIllustration";
import "./post-onboarding-sidebar-guide.css";

type GuideProps = {
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  readonly onDismiss: () => void;
  readonly navigationRefreshEnabled?: boolean;
  readonly hostPlatform?: HostPlatform;
  readonly theme?: "light" | "dark";
};
type CardCopy = { readonly title: TranslationKey; readonly body: TranslationKey };
/** One message per card. Windows names the system tray where macOS names the menu bar. */
function cardCopy(step: PostOnboardingSidebarGuideStep, windows: boolean, navigationRefreshEnabled: boolean): CardCopy {
  switch (step) {
    case "welcome": return { title: "postOnboarding.story.welcomeTitle", body: windows ? "postOnboarding.story.welcomeWindowsBody" : "postOnboarding.story.welcomeBody" };
    case "day": return { title: "postOnboarding.story.dayTitle", body: "postOnboarding.story.dayBody" };
    // The Dev navigation preview has different destinations, so it keeps its own correction copy.
    case "activity": return { title: "postOnboarding.story.activityTitle", body: navigationRefreshEnabled ? "postOnboarding.sidebarGuide.refreshActivityBody" : "postOnboarding.story.activityBody" };
    case "account": return { title: "postOnboarding.story.autoCloseTitle", body: "postOnboarding.story.autoCloseBody" };
    case "tracking": return windows
      ? { title: "postOnboarding.story.trackingWindowsTitle", body: "postOnboarding.story.trackingWindowsBody" }
      : { title: "postOnboarding.story.trackingTitle", body: "postOnboarding.story.trackingBody" };
  }
}
const GUIDE_EXIT_MS = 120;
const GUIDE_PAGE_SETTLE_MS = 260;
type PageTransition = {
  readonly step: PostOnboardingSidebarGuideStep;
  readonly previous: PostOnboardingSidebarGuideStep | null;
  readonly direction: "initial" | "forward" | "backward";
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function keepPageInert(element: HTMLDivElement | null): void {
  if (element) element.inert = true;
}

function usePageTransition(step: PostOnboardingSidebarGuideStep, stepOrder: readonly PostOnboardingSidebarGuideStep[]): PageTransition {
  const [transition, setTransition] = useState<PageTransition>({ step, previous: null, direction: "initial" });
  // Derive both layers before paint, including rapid reversals during a fade.
  if (transition.step !== step) {
    setTransition({
      step,
      previous: prefersReducedMotion() ? null : transition.step,
      direction: stepOrder.indexOf(step) > stepOrder.indexOf(transition.step)
        ? "forward" : "backward",
    });
  }
  useEffect(() => {
    if (!transition.previous) return undefined;
    const timeout = window.setTimeout(() => {
      setTransition(current => current.step === transition.step ? { ...current, previous: null } : current);
    }, GUIDE_PAGE_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [transition.step, transition.previous]);
  return transition;
}

function GuideCopy({
  step, hostPlatform, navigationRefreshEnabled = false, active = false,
}: Pick<GuideProps, "hostPlatform" | "navigationRefreshEnabled"> & {
  readonly step: PostOnboardingSidebarGuideStep;
  readonly active?: boolean;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const copy = cardCopy(step, hostPlatform === "windows", navigationRefreshEnabled);
  return <>
    <h2 id={active ? "post-onboarding-sidebar-guide-title" : undefined}><GuidePhrases text={t(copy.title)} language={effectiveLanguage} /></h2>
    <p id={active ? "post-onboarding-sidebar-guide-body" : undefined}><GuidePhrases text={t(copy.body)} language={effectiveLanguage} /></p>
  </>;
}

/**
 * Keep this mounted and pass `step={null}` to close: the guide then fades out
 * with the app's short exit fade instead of vanishing mid-frame.
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
  step, exiting, onAdvance, onBack, onDismiss, navigationRefreshEnabled = false, hostPlatform = "macos", theme = "light",
}: GuideProps & { readonly step: PostOnboardingSidebarGuideStep; readonly exiting: boolean }) {
  const { t } = useLocalization();
  const sequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS;
  const transition = usePageTransition(step, sequence);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The intro opens with focus on Next so Enter advances. Its focus ring stays hidden until the user
  // presses a key: a mouse user who just finished onboarding should not see a ring around Next, and
  // Chromium and WebKit disagree on whether that programmatic focus is "visible".
  const [keyboardUsed, setKeyboardUsed] = useState(false);
  useEffect(() => {
    if (keyboardUsed) return undefined;
    const mark = (event: KeyboardEvent) => { if (!event.metaKey && !event.ctrlKey) setKeyboardUsed(true); };
    window.addEventListener("keydown", mark, true);
    return () => window.removeEventListener("keydown", mark, true);
  }, [keyboardUsed]);
  const stepIndex = sequence.indexOf(step);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === sequence.length - 1;

  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.inert = exiting;
  }, [exiting]);
  // The intro has its own content. It never opens or highlights live menus.
  // Keep the app out of keyboard and accessibility navigation until it leaves.
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".app-shell");
    if (!app) return;
    const wasInert = app.inert;
    app.inert = true;
    return () => { app.inert = wasInert; };
  }, []);
  // Restore app interaction before the focus trap restores the previous target.
  useModalFocusTrap(panelRef, { initialFocusSelector: "[data-intro-next]", explicitTabNavigation: true });
  useModalDismiss(onDismiss, { disabled: exiting });

  // The header is the progress dots alone; every illustration already shows Drifty.
  const header = (<div className="post-onboarding-sidebar-guide__header">
            <div className="post-onboarding-sidebar-guide__dots" aria-label={t("postOnboarding.sidebarGuide.progress", { current: stepIndex + 1, total: sequence.length })}>
              {sequence.map((id, index) => <i key={id} aria-hidden="true" data-active={index === stepIndex || undefined} />)}
            </div>
          </div>);
  const copy = (<div className="post-onboarding-sidebar-guide__copy" role="status" aria-live="polite" aria-atomic="true">
            <div className="post-onboarding-sidebar-guide__copy-inner" key={step}>
              <GuideCopy step={step} hostPlatform={hostPlatform} navigationRefreshEnabled={navigationRefreshEnabled} active />
            </div>
            {transition.previous && <div className="post-onboarding-sidebar-guide__copy-previous" key={`previous-${transition.previous}`} aria-hidden="true" ref={keepPageInert}>
              <GuideCopy step={transition.previous} hostPlatform={hostPlatform} navigationRefreshEnabled={navigationRefreshEnabled} />
            </div>}
          </div>);
  const actions = (<div className="post-onboarding-sidebar-guide__actions">
            <button type="button" className="app-btn app-btn--quiet" data-intro-back onClick={isFirst ? onDismiss : onBack}>
              {t(isFirst ? "postOnboarding.sidebarGuide.skip" : "postOnboarding.sidebarGuide.back")}
            </button>
            <button type="button" className="app-btn app-btn--primary" data-intro-next onClick={onAdvance}>
              {t(isFirst ? "postOnboarding.sidebarGuide.showAround" : isLast ? "postOnboarding.sidebarGuide.finish" : "postOnboarding.sidebarGuide.next")}
            </button>
          </div>);
  // The outgoing copy shows its card's final state, so a page change never replays an animated card.
  const illustration = (artStep: PostOnboardingSidebarGuideStep, outgoing = false) =>
    <NarrativeGuideIllustration step={artStep} settled={outgoing} hostPlatform={hostPlatform} theme={theme} />;
  const visual = (<div className="post-onboarding-sidebar-guide__visual">
          <div className="post-onboarding-sidebar-guide__visual-page" key={step}>
            {illustration(step)}
          </div>
          {transition.previous && <div className="post-onboarding-sidebar-guide__visual-page post-onboarding-sidebar-guide__visual-page--previous" key={`previous-${transition.previous}`} aria-hidden="true" ref={keepPageInert}>
            {illustration(transition.previous, true)}
          </div>}
        </div>);

  return createPortal(
    <div ref={rootRef} className="post-onboarding-sidebar-guide" data-step={step} data-phase={exiting ? "exiting" : "open"} data-navigation-direction={transition.direction} data-keyboard={keyboardUsed || undefined}>
      <span className="post-onboarding-sidebar-guide__scrim" aria-hidden="true" />
      <span className="post-onboarding-sidebar-guide__drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div ref={panelRef} className="post-onboarding-sidebar-guide__panel" role="dialog" aria-modal="true"
        tabIndex={-1} aria-labelledby="post-onboarding-sidebar-guide-title" aria-describedby="post-onboarding-sidebar-guide-body"
        data-modal-presence={exiting ? "exiting" : "open"}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
          if (event.key === "ArrowRight" || (event.target === event.currentTarget && event.key === "Enter")) {
            event.preventDefault(); event.stopPropagation(); onAdvance();
          } else if (event.key === "ArrowLeft" && !isFirst) {
            event.preventDefault(); event.stopPropagation(); onBack();
          }
        }}>
        <div className="post-onboarding-sidebar-guide__left">{header}{copy}{actions}</div>
        {visual}

      </div>
    </div>, document.body,
  );
}
