import type { DisplayLanguage } from "../localization/languageCatalog";
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
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, isPostOnboardingGuideLastStep, nextPostOnboardingMustSeeStep, postOnboardingSkipPath,
  type PostOnboardingGuideSequence, type PostOnboardingSidebarGuideStep,
} from "./postOnboardingSidebarGuide";
import { NarrativeGuideIllustration } from "./components/NarrativeGuideIllustration";
import { GuideCatTile } from "./components/GuideCatTile";
import { GuidePetNamePopover } from "./components/GuidePetNamePopover";
import { usePetName } from "../pet-mode/petName";
import { useScrollOverflowEdges } from "./useScrollOverflowEdges";
import type { FirstDayRecap, FirstDayStoryDay } from "./firstDayStory";
import { breakdownCardText, noFocusCardText, noFocusCardVariant, rebalancedFixHint } from "./noFocusCardVariants";
import { isRebalancedIntroLayout } from "./postOnboardingSidebarGuide";
import { storyKindsList } from "./storyCategories";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import "./post-onboarding-sidebar-guide.css";
import type { AutoCloseMode } from "../focus-session/focusSession";

/**
 * The intro's drift decision, the same two independent choices the first-run setup used to offer:
 * Automatic close (Beta, confirmed before it turns on) and the desktop cat. Drift alerts stay a
 * Settings choice (product decision 2026-09-22). Automatic close is Off, During sessions or Always;
 * the card starts on During sessions and asks for consent when Next takes it (owner review 2026-11-20).
 */
export type GuideDecision = {
  readonly autoCloseMode: AutoCloseMode;
  readonly petEnabled: boolean;
  readonly onAutoCloseModeChange: (mode: AutoCloseMode) => void;
  readonly onPetChange: (enabled: boolean) => void;
};

const DECISION_MODES: readonly { readonly value: AutoCloseMode; readonly label: TranslationKey; readonly description: TranslationKey }[] = [
  { value: "session", label: "autoClose.mode.session", description: "autoClose.intro.session" },
  { value: "always", label: "autoClose.mode.always", description: "autoClose.intro.always" },
  { value: "off", label: "autoClose.mode.off", description: "autoClose.intro.off" },
];

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
  /** Skip (and Escape) while a must-see card is ahead: jump to it instead of closing. */
  readonly onSkip?: () => void;
  /** After Skip the intro shows only the remaining must-see cards; the last one ends it. */
  readonly skipped?: boolean;
  /** The card Skip was first pressed on; the dots keep the cards up to it. */
  readonly skippedFrom?: PostOnboardingSidebarGuideStep | null;
  readonly hostPlatform?: HostPlatform;
  readonly theme?: "light" | "dark";
};
type CardCopy = { readonly title: TranslationKey; readonly body: TranslationKey };
/** One message per card. Windows names the system tray where macOS names the menu bar. */
function cardCopy(step: PostOnboardingSidebarGuideStep, windows: boolean): CardCopy {
  switch (step) {
    case "recap":
    case "breakdown":
    case "drift":
    case "welcome": return { title: "postOnboarding.story.welcomeTitle", body: windows ? "postOnboarding.story.welcomeWindowsBody" : "postOnboarding.story.welcomeBody" };
    case "day": return { title: "postOnboarding.story.dayTitle", body: "postOnboarding.story.dayBody" };
    case "activity": return { title: "postOnboarding.story.activityTitle", body: "postOnboarding.story.activityBody" };
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
 * The places a story with almost no focus names, as one list in the display language. Korean reads more
 * naturally as a plain comma list than with Intl's formal 및.
 */
function sourceList(labels: readonly string[], language: DisplayLanguage): string {
  if (language === "ko") return labels.join(", ");
  // Intl.ListFormat is ES2021; the TypeScript lib here predates it, so reach it through a narrow type.
  const ListFormat = (Intl as unknown as {
    readonly ListFormat?: new (locale: string, options: { readonly type: "conjunction" }) => { format(items: readonly string[]): string };
  }).ListFormat;
  if (!ListFormat) return labels.join(", ");
  try {
    return new ListFormat(language, { type: "conjunction" }).format(labels);
  } catch {
    return labels.join(", ");
  }
}

/** The focus title for the day the story tells: [watched or mixed, rebuilt from browser history]. */
const RECAP_TITLE_KEYS = {
  yesterday: ["postOnboarding.story.recapTitleYesterday", "postOnboarding.story.recapTitleYesterdayBrowser"],
  today: ["postOnboarding.story.recapTitleToday", "postOnboarding.story.recapTitleTodayBrowser"],
  dayBefore: ["postOnboarding.story.recapTitleDayBefore", "postOnboarding.story.recapTitleDayBeforeBrowser"],
} as const satisfies Record<FirstDayStoryDay, readonly [TranslationKey, TranslationKey]>;
/** The title when the story opens on the time it read because focus was short; same layout as above. */
const RECAP_OVERVIEW_TITLE_KEYS = {
  yesterday: ["postOnboarding.story.recapOverviewTitleYesterday", "postOnboarding.story.recapOverviewTitleYesterdayBrowser"],
  today: ["postOnboarding.story.recapOverviewTitleToday", "postOnboarding.story.recapOverviewTitleTodayBrowser"],
  dayBefore: ["postOnboarding.story.recapOverviewTitleDayBefore", "postOnboarding.story.recapOverviewTitleDayBeforeBrowser"],
} as const satisfies Record<FirstDayStoryDay, readonly [TranslationKey, TranslationKey]>;
/** The title when a day with almost no focus opens on its time sorted by kind; same layout as above. */
const RECAP_KINDS_TITLE_KEYS = {
  yesterday: ["postOnboarding.story.recapKindsTitleYesterday", "postOnboarding.story.recapKindsTitleYesterdayBrowser"],
  today: ["postOnboarding.story.recapKindsTitleToday", "postOnboarding.story.recapKindsTitleTodayBrowser"],
  dayBefore: ["postOnboarding.story.recapKindsTitleDayBefore", "postOnboarding.story.recapKindsTitleDayBeforeBrowser"],
} as const satisfies Record<FirstDayStoryDay, readonly [TranslationKey, TranslationKey]>;
/** How many categories a day with almost no focus names; the rest of its chart reads as Other. */
const RECAP_KINDS_NAMED = 3;

/**
 * The story cards tell the user's own first day; their copy is built from the recap's facts. A day
 * rebuilt only from browser history says "in your browser" in its titles: the browser knows nothing
 * of app time, so the totals are the browser's, not the whole day's. The first title names the day the
 * story tells (yesterday, so far today, or the day before yesterday; see resolveFirstDayRecap). With
 * under 30 minutes of focus the first card opens on the classified time it read and names the focus in
 * its body; with almost no focus it names where that time went instead. With almost no drift the second
 * card says so plainly instead of naming a source.
 */
function storyText(step: PostOnboardingSidebarGuideStep, recap: FirstDayRecap | null | undefined, t: Translate, language: DisplayLanguage): GuideText | null {
  if (!recap || (step !== "recap" && step !== "breakdown" && step !== "drift")) return null;
  // Review prototype of the rebalanced story: a middle card on the day, and the drift card says where to correct.
  if (step === "breakdown") return breakdownCardText(recap, language, t);
  const fixHint = isRebalancedIntroLayout() ? rebalancedFixHint(language) : null;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const browser = recap.importedOnly;
  if (step === "recap") {
    const focus = duration(recap.focusSeconds);
    const stretch = recap.longestFocus ? {
      time: formatLocalizedTimeLabel(recap.longestFocus.startedAt, language),
      duration: duration(recap.longestFocus.seconds),
      source: recap.longestFocus.source.label,
    } : null;
    if (recap.lead === "kinds") {
      // Review prototype: the dev server can open this card on other facts (see noFocusCardVariants).
      const variant = noFocusCardVariant();
      const variantText = noFocusCardText(variant, recap, language, t);
      if (variantText) return variantText;
      if (variant === "places") {
        const places = recap.topSources.map((entry) => entry.source.label);
        return {
          title: t(RECAP_OVERVIEW_TITLE_KEYS[recap.dayRelation][browser ? 1 : 0], { total: duration(recap.classifiedSeconds) }),
          body: places.length > 0 ? t("postOnboarding.story.recapSourcesBody", { sources: sourceList(places, language) }) : "",
        };
      }
      const kinds = recap.categories.slice(0, RECAP_KINDS_NAMED);
      return {
        title: t(RECAP_KINDS_TITLE_KEYS[recap.dayRelation][browser ? 1 : 0], { total: duration(recap.classifiedSeconds) }),
        body: kinds.length > 0 ? t("postOnboarding.story.recapKindsBody", { kinds: storyKindsList(kinds, language, t) }) : "",
      };
    }
    if (recap.lead === "overview") {
      return {
        title: t(RECAP_OVERVIEW_TITLE_KEYS[recap.dayRelation][browser ? 1 : 0], { total: duration(recap.classifiedSeconds) }),
        body: stretch ? t("postOnboarding.story.recapOverviewBody", { focus, ...stretch }) : "",
      };
    }
    const title = t(RECAP_TITLE_KEYS[recap.dayRelation][browser ? 1 : 0], { focus });
    const longest = stretch ? t("postOnboarding.story.recapBody", stretch) : "";
    return { title, body: longest };
  }
  if (recap.topDrift) {
    return {
      title: t(browser ? "postOnboarding.story.driftTitleBrowser" : "postOnboarding.story.driftTitle", { duration: duration(recap.driftSeconds) }),
      // A wrong verdict is the first thing a user wants to fix here; the card after the decision shows how.
      body: t("postOnboarding.story.driftBody", { source: recap.topDrift.source.label, duration: duration(recap.topDrift.seconds) })
        + " " + (fixHint?.drift ?? t("postOnboarding.story.driftFixHint")),
    };
  }
  const quietBody = browser
    ? t("postOnboarding.story.driftNoneBodyBrowser")
    : recap.driftSeconds > 0
      ? t("postOnboarding.story.driftNoneBody", { duration: duration(recap.driftSeconds) })
      : t("postOnboarding.story.driftZeroBody");
  return {
    // Today is still going, so it is not yet "a day" with almost no drift.
    title: t(browser ? "postOnboarding.story.driftNoneTitleBrowser"
      : recap.dayRelation === "today" ? "postOnboarding.story.driftNoneTitleToday" : "postOnboarding.story.driftNoneTitle"),
    // In the browser alone, "no drift" may only mean the drift happened in apps; say what comes next.
    body: fixHint ? quietBody + " " + fixHint.quiet : quietBody,
  };
}

/**
 * The drift decision rows. Automatic close is one of three choices; a choice that would turn it on is
 * held on the card until Next, which asks for consent first.
 */
function DecisionControls({ decision, shownMode, active, onChooseMode, petName = "", greetSignal = 0, onRequestNaming }: {
  readonly decision: GuideDecision;
  /** The choice the card shows: the saved one, or the one held until Next. */
  readonly shownMode: AutoCloseMode;
  readonly active: boolean;
  readonly onChooseMode: (mode: AutoCloseMode) => void;
  /** The cat's confirmed name; empty until the user names it. */
  readonly petName?: string;
  /** Changes when a name is confirmed, so the cat greets its new name. */
  readonly greetSignal?: number;
  readonly onRequestNaming?: () => void;
}) {
  const { t } = useLocalization();
  const closeLabel = t("onboarding.nudges.choiceClose");
  const on = shownMode !== "off";
  return (
    <div className="guide-decision">
      <div className="guide-decision__row guide-decision__row--modes" data-on={on || undefined}>
        <span className="guide-decision__row-copy">
          <span className="guide-decision__row-title">{closeLabel}<span className="status-badge status-badge--beta">{t("common.beta")}</span></span>
          <span className="guide-decision__row-desc" id={active ? "post-onboarding-sidebar-guide-body" : undefined}>
            {t((DECISION_MODES.find((option) => option.value === shownMode) ?? DECISION_MODES[0]).description)}
          </span>
        </span>
        <span className="guide-decision__modes" role="radiogroup" aria-label={closeLabel}>
          {DECISION_MODES.map((option) => (
            <button key={option.value} type="button" role="radio" className="guide-decision__mode"
              aria-checked={shownMode === option.value} data-on={shownMode === option.value || undefined}
              onClick={() => onChooseMode(option.value)}>
              {t(option.label)}
              {option.value === "session" ? <span className="guide-decision__mode-hint">{t("autoClose.mode.recommended")}</span> : null}
            </button>
          ))}
        </span>
      </div>
      <div className="guide-decision__row guide-decision__row--pet" data-on={decision.petEnabled || undefined}>
        <GuideCatTile enabled={decision.petEnabled} greetSignal={greetSignal} label={t("onboarding.nudges.petPreview")} onEnable={() => decision.onPetChange(true)} />
        <span className="guide-decision__row-copy">
          <span className="guide-decision__row-title">{t("onboarding.nudges.pet")}</span>
          {decision.petEnabled && onRequestNaming ? (
            <button type="button" className="guide-decision__name" onClick={onRequestNaming}>
              {petName ? <>{t("petName.rowLabel")} <strong>{petName}</strong></> : t("petName.rowUnnamed")}
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L6 12.5l-3 .7.7-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            </button>
          ) : null}
        </span>
        <Toggle checked={decision.petEnabled} ariaLabel={t("onboarding.nudges.pet")} onChange={decision.onPetChange} />
      </div>
    </div>
  );
}


function GuideCopy({
  step, hostPlatform, active = false, recap, decision, shownMode, onChooseMode, petName, greetSignal, onRequestNaming,
}: Pick<GuideProps, "hostPlatform" | "recap" | "decision"> & {
  readonly step: PostOnboardingSidebarGuideStep;
  readonly active?: boolean;
  readonly shownMode?: AutoCloseMode;
  readonly onChooseMode?: (mode: AutoCloseMode) => void;
  readonly petName?: string;
  readonly greetSignal?: number;
  readonly onRequestNaming?: () => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const titleId = active ? "post-onboarding-sidebar-guide-title" : undefined;
  if (step === "account" && decision) {
    return <>
      {/* After a day with almost no drift the question looks ahead instead of back. */}
      <h2 id={titleId}><GuidePhrases text={t(recap && !recap.topDrift ? "postOnboarding.decide.titleNoDrift" : "postOnboarding.decide.title")} language={effectiveLanguage} /></h2>
      <DecisionControls decision={decision} shownMode={shownMode ?? decision.autoCloseMode} active={active} onChooseMode={onChooseMode ?? (() => undefined)}
        petName={petName} greetSignal={greetSignal} onRequestNaming={onRequestNaming} />
    </>;
  }
  const copy = cardCopy(step, hostPlatform === "windows");
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
  step, exiting, onAdvance, onBack, onDismiss, onSkip, skipped = false, skippedFrom = null, hostPlatform = "macos", theme = "light",
  sequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, recap = null, decision,
}: GuideProps & { readonly step: PostOnboardingSidebarGuideStep; readonly exiting: boolean }) {
  const { t } = useLocalization();
  const [confirmingMode, setConfirmingMode] = useState<AutoCloseMode | null>(null);
  useEffect(() => { setConfirmingMode(null); }, [step]);
  const confirming = confirmingMode !== null && step === "account" && Boolean(decision);
  // A choice that would turn Automatic close on waits on the card; untouched, the card shows During sessions.
  const [heldMode, setHeldMode] = useState<AutoCloseMode | null>(null);
  const savedMode = decision?.autoCloseMode ?? "off";
  const shownMode: AutoCloseMode = savedMode !== "off" ? savedMode : heldMode ?? "session";
  const chooseMode = (mode: AutoCloseMode) => {
    setHeldMode(mode);
    if (mode === "off") {
      // Off here is not the last word: the first focus session still offers it once (owner review 2026-11-20).
      if (savedMode !== "off") decision?.onAutoCloseModeChange("off");
    } else if (savedMode !== "off") {
      decision?.onAutoCloseModeChange(mode);
    }
  };
  // Next from the decision with a held choice asks for consent first; Turn on then moves on.
  const advance = () => {
    if (step === "account" && decision && savedMode === "off" && shownMode !== "off") {
      setConfirmingMode(shownMode);
      return;
    }
    onAdvance();
  };
  // Naming the desktop cat: asked once the cat is turned on, never filled in for the user.
  const [petName, setPetName] = usePetName();
  const [namingOpen, setNamingOpen] = useState(false);
  const [greetSignal, setGreetSignal] = useState(0);
  const petOn = decision?.petEnabled ?? false;
  const petWasOn = useRef(petOn);
  useEffect(() => {
    const turnedOn = petOn && !petWasOn.current;
    petWasOn.current = petOn;
    if (!petOn) setNamingOpen(false);
    else if (turnedOn && step === "account" && !petName) setNamingOpen(true);
  }, [petOn, petName, step]);
  useEffect(() => { setNamingOpen(false); }, [step]);
  const naming = namingOpen && petOn && step === "account" && Boolean(decision) && !confirming;
  const closeNaming = () => {
    setNamingOpen(false);
    window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(".post-onboarding-sidebar-guide__copy-inner .guide-decision__name")?.focus());
  };
  const transition = usePageTransition(step, sequence);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Long translations of the drift decision do not fit the fixed card. Its copy scrolls, with the
  // setup's edge fade as the cue, instead of running under Back and Next.
  const copyRef = useRef<HTMLDivElement>(null);
  const copyOverflow = useScrollOverflowEdges(copyRef, `${step}:${petOn}:${petName}`);
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
  // After Skip the last must-see card ends the intro like the last card.
  const isLast = isPostOnboardingGuideLastStep(step, sequence, skipped);
  const skip = onSkip && nextPostOnboardingMustSeeStep(step, sequence) ? onSkip : onDismiss;
  // After Skip the dots of the skipped cards fold away, so the progress counts only the cards the
  // user saw and the must-see cards still ahead, instead of promising cards that will not come.
  const progressPath = skipped ? postOnboardingSkipPath(sequence, skippedFrom ?? sequence[0]) : sequence;

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
  useModalDismiss(skip, { disabled: exiting || confirming || naming });

  // The header is the progress dots alone; every illustration already shows Drifty.
  const header = (<div className="post-onboarding-sidebar-guide__header">
            <div className="post-onboarding-sidebar-guide__dots" aria-label={t("postOnboarding.sidebarGuide.progress", { current: progressPath.indexOf(step) + 1, total: progressPath.length })}>
              {sequence.map((id, index) => <i key={id} aria-hidden="true" data-active={index === stepIndex || undefined} data-dropped={!progressPath.includes(id) || undefined} />)}
            </div>
          </div>);
  const copy = (<div ref={copyRef} className="post-onboarding-sidebar-guide__copy" data-overflow={copyOverflow} role="status" aria-live="polite" aria-atomic="true">
            <div className="post-onboarding-sidebar-guide__copy-inner" key={step}>
              <GuideCopy step={step} hostPlatform={hostPlatform} recap={recap} decision={decision}
                shownMode={shownMode} onChooseMode={chooseMode} active
                petName={petName} greetSignal={greetSignal} onRequestNaming={() => setNamingOpen(true)} />
            </div>
            {transition.previous && <div className="post-onboarding-sidebar-guide__copy-previous" key={`previous-${transition.previous}`} aria-hidden="true" ref={keepPageInert}>
              <GuideCopy step={transition.previous} hostPlatform={hostPlatform} recap={recap} decision={decision} shownMode={shownMode} petName={petName} />
            </div>}
          </div>);
  const actions = (<div className="post-onboarding-sidebar-guide__actions">
            <button type="button" className="app-btn app-btn--quiet" data-intro-back onClick={isFirst ? skip : onBack}>
              {t(isFirst ? "postOnboarding.sidebarGuide.skip" : "postOnboarding.sidebarGuide.back")}
            </button>
            <button type="button" className="app-btn app-btn--primary" data-intro-next onClick={advance}>
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
    <NarrativeGuideIllustration step={artStep} settled={outgoing} hostPlatform={hostPlatform} theme={theme} recap={recap} petEnabled={decision?.petEnabled} driftChoice={decision ? (shownMode !== "off" ? "close" : "watch") : undefined} />
    : <NarrativeGuideIllustration step={artStep} hostPlatform={hostPlatform} theme={theme} recap={recap}
      driftChoice={shownMode !== "off" ? "close" : "watch"} petEnabled={decision.petEnabled} />;
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
          if (event.target instanceof HTMLElement && event.target.closest(".guide-name-pop")) return;
          if (event.key === "ArrowRight" || (event.target === event.currentTarget && event.key === "Enter")) {
            event.preventDefault(); event.stopPropagation(); advance();
          } else if (event.key === "ArrowLeft" && !isFirst) {
            event.preventDefault(); event.stopPropagation(); onBack();
          }
        }}>
        <div className="post-onboarding-sidebar-guide__left">{header}{copy}{actions}</div>{visual}
        {naming ? (
          <GuidePetNamePopover panelRef={panelRef} initialName={petName}
            site={recap?.topDriftSite?.label ?? "youtube.com"}
            onLater={closeNaming}
            onConfirm={(name) => { setPetName(name); setGreetSignal((value) => value + 1); closeNaming(); }} />
        ) : null}
      </div>
      <ModalPresence>
        {confirming ? (
          <AutomaticCloseConfirmDialog
            petEnabled={decision?.petEnabled} driftSource={recap?.topDriftSite} windows={hostPlatform === "windows"}
            sessionOnly={confirmingMode === "session"}
            onCancel={() => { setConfirmingMode(null); chooseMode("off"); }}
            onConfirm={() => {
              const mode = confirmingMode ?? "session";
              setConfirmingMode(null);
              decision?.onAutoCloseModeChange(mode);
              onAdvance();
            }}
          />
        ) : null}
      </ModalPresence>
    </div>, document.body,
  );
}
