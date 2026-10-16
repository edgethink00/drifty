import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { Toggle } from "../../components/Toggle";
import { ModalPresence } from "../../components/ModalPresence";
import { AutomaticCloseConfirmDialog } from "./AutomaticCloseConfirmDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { GuidePhrases } from "./guideLineBreaks";
import type { TranslationKey } from "../localization/translations";
import { POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, type PostOnboardingGuideSequence, type PostOnboardingSidebarGuideStep } from "./postOnboardingSidebarGuide";
import { NarrativeGuideIllustration } from "./components/NarrativeGuideIllustration";
import { GuideCatTile } from "./components/GuideCatTile";
import type { FirstDayRecap } from "./firstDayStory";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import "./post-onboarding-sidebar-guide.css";

/**
 * The intro's drift decision, the same two independent choices the first-run setup used to offer:
 * Automatic close (Beta, confirmed before it turns on) and the desktop cat. Drift alerts stay a
 * Settings choice (product decision 2026-09-22).
 */
export type GuideDecision = {
  readonly autoCloseEnabled: boolean;
  readonly petEnabled: boolean;
  readonly onAutoCloseChange: (enabled: boolean) => void;
  readonly onPetChange: (enabled: boolean) => void;
};

type GuideProps = {
  /** The cards in order; the story sequence opens on the user's own first day. */
  readonly sequence?: PostOnboardingGuideSequence;
  /** The first day the story cards tell; required for the recap and drift cards. */
  readonly recap?: FirstDayRecap | null;
  /** The drift decision card's live choice. Without it the card stays the Automatic close explainer. */
  readonly decision?: GuideDecision;
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
    case "recap":
    case "drift":
    case "welcome": return { title: "postOnboarding.story.welcomeTitle", body: windows ? "postOnboarding.story.welcomeWindowsBody" : "postOnboarding.story.welcomeBody" };
    case "day": return { title: "postOnboarding.story.dayTitle", body: "postOnboarding.story.dayBody" };
    // The Dev navigation preview has different destinations, so it keeps its own correction copy.
    case "activity": return { title: "postOnboarding.story.activityTitle", body: navigationRefreshEnabled ? "postOnboarding.sidebarGuide.refreshActivityBody" : "postOnboarding.story.activityBody" };
    case "account": return { title: "postOnboarding.story.autoCloseTitle", body: "postOnboarding.story.autoCloseBody" };
    // The last card hands over to the dashboard the same way whether or not the story had a day to tell.
    case "handoff": return { title: "postOnboarding.handoff.title", body: "postOnboarding.handoff.body" };
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

type GuideText = { readonly title: string; readonly body: string };
type Translate = ReturnType<typeof useLocalization>["t"];

/**
 * The story cards tell the user's own first day; their copy is built from the recap's facts. A day
 * rebuilt only from browser history says "in your browser" in its titles: the browser knows nothing
 * of app time, so the totals are the browser's, not the whole day's. The story is always about yesterday
 * (see buildFirstDayRecap). With almost no drift the second card says so plainly instead of naming a source.
 */
function storyText(step: PostOnboardingSidebarGuideStep, recap: FirstDayRecap | null | undefined, t: Translate, language: "en" | "ko" | "es"): GuideText | null {
  if (!recap || (step !== "recap" && step !== "drift")) return null;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const browser = recap.importedOnly;
  if (step === "recap") {
    const focus = duration(recap.focusSeconds);
    const title = t(browser ? "postOnboarding.story.recapTitleYesterdayBrowser" : "postOnboarding.story.recapTitleYesterday", { focus });
    const longest = recap.longestFocus
      ? t("postOnboarding.story.recapBody", {
        time: formatLocalizedTimeLabel(recap.longestFocus.startedAt, language),
        duration: duration(recap.longestFocus.seconds),
        source: recap.longestFocus.source.label,
      })
      : "";
    return { title, body: longest };
  }
  if (recap.topDrift) {
    return {
      title: t(browser ? "postOnboarding.story.driftTitleBrowser" : "postOnboarding.story.driftTitle", { duration: duration(recap.driftSeconds) }),
      // A wrong verdict is the first thing a user wants to fix here; the card after the decision shows how.
      body: t("postOnboarding.story.driftBody", { source: recap.topDrift.source.label, duration: duration(recap.topDrift.seconds) })
        + " " + t("postOnboarding.story.driftFixHint"),
    };
  }
  return {
    title: t(browser ? "postOnboarding.story.driftNoneTitleBrowser" : "postOnboarding.story.driftNoneTitle"),
    // In the browser alone, "no drift" may only mean the drift happened in apps; say what comes next.
    body: browser
      ? t("postOnboarding.story.driftNoneBodyBrowser")
      : recap.driftSeconds > 0
        ? t("postOnboarding.story.driftNoneBody", { duration: duration(recap.driftSeconds) })
        : t("postOnboarding.story.driftZeroBody"),
  };
}

/** The drift decision rows. Turning Automatic close on opens its consent popup instead of applying it. */
function DecisionControls({ decision, active, onRequestAutoClose }: {
  readonly decision: GuideDecision;
  readonly active: boolean;
  readonly onRequestAutoClose: () => void;
}) {
  const { t } = useLocalization();
  const closeLabel = t("onboarding.nudges.choiceClose");
  return (
    <div className="guide-decision">
      <div className="guide-decision__row" data-on={decision.autoCloseEnabled || undefined}>
        <span className="guide-decision__row-copy">
          <span className="guide-decision__row-title">{closeLabel}<span className="status-badge status-badge--beta">{t("common.beta")}</span></span>
          <span className="guide-decision__row-desc" id={active ? "post-onboarding-sidebar-guide-body" : undefined}>
            {t(decision.petEnabled ? "onboarding.nudges.choiceCloseCatDescription" : "onboarding.nudges.choiceCloseDescription")}
          </span>
        </span>
        <Toggle
          checked={decision.autoCloseEnabled}
          ariaLabel={closeLabel}
          onChange={(enabled) => (enabled ? onRequestAutoClose() : decision.onAutoCloseChange(false))}
        />
      </div>
      <div className="guide-decision__row guide-decision__row--pet" data-on={decision.petEnabled || undefined}>
        <GuideCatTile enabled={decision.petEnabled} label={t("onboarding.nudges.petPreview")} onEnable={() => decision.onPetChange(true)} />
        <span className="guide-decision__row-copy">
          <span className="guide-decision__row-title">{t("onboarding.nudges.pet")}</span>
        </span>
        <Toggle checked={decision.petEnabled} ariaLabel={t("onboarding.nudges.pet")} onChange={decision.onPetChange} />
      </div>
    </div>
  );
}


function GuideCopy({
  step, hostPlatform, navigationRefreshEnabled = false, active = false, recap, decision, onRequestAutoClose,
}: Pick<GuideProps, "hostPlatform" | "navigationRefreshEnabled" | "recap" | "decision"> & {
  readonly step: PostOnboardingSidebarGuideStep;
  readonly active?: boolean;
  readonly onRequestAutoClose?: () => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const titleId = active ? "post-onboarding-sidebar-guide-title" : undefined;
  if (step === "account" && decision) {
    return <>
      {/* After a day with almost no drift the question looks ahead instead of back. */}
      <h2 id={titleId}><GuidePhrases text={t(recap && !recap.topDrift ? "postOnboarding.decide.titleNoDrift" : "postOnboarding.decide.title")} language={effectiveLanguage} /></h2>
      <DecisionControls decision={decision} active={active} onRequestAutoClose={onRequestAutoClose ?? (() => undefined)} />
    </>;
  }
  const copy = cardCopy(step, hostPlatform === "windows", navigationRefreshEnabled);
  const text = storyText(step, recap, t, effectiveLanguage) ?? { title: t(copy.title), body: t(copy.body) };
  return <>
    <h2 id={titleId}><GuidePhrases text={text.title} language={effectiveLanguage} /></h2>
    <p id={active ? "post-onboarding-sidebar-guide-body" : undefined}><GuidePhrases text={text.body} language={effectiveLanguage} /></p>
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
  sequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, recap = null, decision,
}: GuideProps & { readonly step: PostOnboardingSidebarGuideStep; readonly exiting: boolean }) {
  const { t } = useLocalization();
  const [confirmingClose, setConfirmingClose] = useState(false);
  useEffect(() => { setConfirmingClose(false); }, [step]);
  const confirming = confirmingClose && step === "account" && Boolean(decision);
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
  // Keep the app out of keyboard and accessibility navigation until it leaves. On Windows the client
  // titlebar sits outside .app-shell and above every dialog, so its app controls (sidebar, history,
  // AI status, update) are held too; caption buttons and the drag region stay usable, as in a native
  // Windows dialog.
  useEffect(() => {
    const held = Array.from(document.querySelectorAll<HTMLElement>(".app-shell, .windows-titlebar__leading, .windows-titlebar__trailing"))
      .map(element => ({ element, wasInert: element.inert }));
    for (const { element } of held) element.inert = true;
    return () => { for (const { element, wasInert } of held) element.inert = wasInert; };
  }, []);
  // Restore app interaction before the focus trap restores the previous target.
  useModalFocusTrap(panelRef, { initialFocusSelector: "[data-intro-next]", explicitTabNavigation: true });
  useModalDismiss(onDismiss, { disabled: exiting || confirming });

  // The header is the progress dots alone; every illustration already shows Drifty.
  const header = (<div className="post-onboarding-sidebar-guide__header">
            <div className="post-onboarding-sidebar-guide__dots" aria-label={t("postOnboarding.sidebarGuide.progress", { current: stepIndex + 1, total: sequence.length })}>
              {sequence.map((id, index) => <i key={id} aria-hidden="true" data-active={index === stepIndex || undefined} />)}
            </div>
          </div>);
  const copy = (<div className="post-onboarding-sidebar-guide__copy" role="status" aria-live="polite" aria-atomic="true">
            <div className="post-onboarding-sidebar-guide__copy-inner" key={step}>
              <GuideCopy step={step} hostPlatform={hostPlatform} navigationRefreshEnabled={navigationRefreshEnabled} recap={recap} decision={decision}
                onRequestAutoClose={() => setConfirmingClose(true)} active />
            </div>
            {transition.previous && <div className="post-onboarding-sidebar-guide__copy-previous" key={`previous-${transition.previous}`} aria-hidden="true" ref={keepPageInert}>
              <GuideCopy step={transition.previous} hostPlatform={hostPlatform} navigationRefreshEnabled={navigationRefreshEnabled} recap={recap} decision={decision} />
            </div>}
          </div>);
  const actions = (<div className="post-onboarding-sidebar-guide__actions">
            <button type="button" className="app-btn app-btn--quiet" data-intro-back onClick={isFirst ? onDismiss : onBack}>
              {t(isFirst ? "postOnboarding.sidebarGuide.skip" : "postOnboarding.sidebarGuide.back")}
            </button>
            <button type="button" className="app-btn app-btn--primary" data-intro-next onClick={onAdvance}>
              {t(isFirst && step === "welcome" ? "postOnboarding.sidebarGuide.showAround" : isLast ? "postOnboarding.sidebarGuide.finish" : "postOnboarding.sidebarGuide.next")}
              {isLast ? null : (
                <svg className="post-onboarding-sidebar-guide__next-arrow" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>);
  // The outgoing copy shows its card's final state, so a page change never replays an animated card.
  const illustration = (artStep: PostOnboardingSidebarGuideStep, outgoing = false) => outgoing || !decision ?
    <NarrativeGuideIllustration step={artStep} settled={outgoing} hostPlatform={hostPlatform} theme={theme} recap={recap} petEnabled={decision?.petEnabled} driftChoice={decision ? (decision.autoCloseEnabled ? "close" : "watch") : undefined} />
    : <NarrativeGuideIllustration step={artStep} hostPlatform={hostPlatform} theme={theme} recap={recap}
      driftChoice={decision.autoCloseEnabled ? "close" : "watch"} petEnabled={decision.petEnabled} />;
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
        <div className="post-onboarding-sidebar-guide__left">{header}{copy}{actions}</div>{visual}

      </div>
      <ModalPresence>
        {confirming ? (
          <AutomaticCloseConfirmDialog
            petEnabled={decision?.petEnabled} driftSource={recap?.topDriftSite} windows={hostPlatform === "windows"}
            onCancel={() => setConfirmingClose(false)}
            onConfirm={() => { setConfirmingClose(false); decision?.onAutoCloseChange(true); }}
          />
        ) : null}
      </ModalPresence>
    </div>, document.body,
  );
}
