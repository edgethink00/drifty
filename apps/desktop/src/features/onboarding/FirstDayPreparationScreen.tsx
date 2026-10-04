import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { remainingLabelText } from "../loading/remainingEstimateCopy";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import { onboardingActivityLabel } from "./onboardingOptionLabels";
import type {
  FirstDayPreparationPhase,
  FirstDayPreparationPlan,
} from "./firstDayPreparationProgress";
import { useFirstDayPreparationTrack } from "./useFirstDayPreparationTrack";
import { FirstDayTokenStage } from "./FirstDayDiscoveryStack";
import { FIRST_DAY_LANDING_MS, useVerdictFlights } from "./firstDayPrepMotion";
import { firstDayReadingSummary, useFirstDayFreshKey, useFirstDaySplit } from "./firstDayNarration";
import type { FirstDayChart, FirstDayDiscoveries, FirstDaySource } from "./firstDayPreparationStory";
import type { AppIconMap } from "@drifty/domain";
import "./styles/first-day-preparation.css";

export type { FirstDayPreparationPhase, FirstDayPreparationPlan } from "./firstDayPreparationProgress";
export type FirstDayPreparationFailureReason =
  | "cloud_not_ready"
  | "classification_incomplete"
  | "preparation_timed_out";

type PhaseCopy = {
  readonly title: string;
  readonly lines: readonly string[];
};

const LINE_ROTATION_MS = 8450;
const EMPTY_ITEMS: readonly never[] = [];
const EMPTY_SOURCES: readonly FirstDaySource[] = [];
/** A receipt needs a day worth describing; a few seconds of history is not one. */
const RECEIPT_MIN_SECONDS = 60;

// Fallback for a caller that does not declare its phases: the screen bands the
// run around whichever phases it actually sees. The app always passes a plan,
// because a plan discovered mid-run moves the band boundaries under a bar that
// is only allowed to move forward.
const IMPLICIT_PLAN: FirstDayPreparationPlan = [];

// The one personalized touch: lead the classifying phase with the work the user
// named during onboarding, so the first loading screen shows Drifty remembered.
function classifyingLines(workActivityLabel: string | null | undefined, copy: PhaseCopy, t: LocalizationController["t"]): readonly string[] {
  const base = copy.lines;
  if (!workActivityLabel) return base;
  return [t("onboarding.preparing.personalized", { activity: workActivityLabel }), ...base];
}

type Translate = LocalizationController["t"];
type Language = LocalizationController["effectiveLanguage"];

/** Source names longer than this are shortened in the line, so a long app name cannot wrap it and push the bar. */
const SOURCE_LABEL_MAX = 28;

export function firstDaySourceLabel(label: string): string {
  const chars = Array.from(label.trim());
  return chars.length > SOURCE_LABEL_MAX ? chars.slice(0, SOURCE_LABEL_MAX - 1).join("").trimEnd() + "…" : chars.join("");
}

function readingLine(reading: readonly FirstDaySource[], t: Translate): string | null {
  const summary = firstDayReadingSummary(reading);
  if (!summary) return null;
  const source = firstDaySourceLabel(summary.lead);
  return summary.others > 0
    ? t("onboarding.preparing.readingMany", { source, count: summary.others })
    : t("onboarding.preparing.readingOne", { source });
}

function receiptSources(discoveries: FirstDayDiscoveries, t: Translate): string | null {
  const { appCount, siteCount } = discoveries;
  const apps = appCount === 1 ? t("onboarding.preparing.receiptApp") : t("onboarding.preparing.receiptApps", { count: appCount });
  const sites = siteCount === 1 ? t("onboarding.preparing.receiptSite") : t("onboarding.preparing.receiptSites", { count: siteCount });
  return appCount > 0 && siteCount > 0 ? t("onboarding.preparing.receiptBoth", { apps, sites }) : appCount > 0 ? apps : siteCount > 0 ? sites : null;
}

function receiptLine(
  discoveries: FirstDayDiscoveries | null,
  dayRelation: "today" | "yesterday" | "earlier",
  t: Translate,
  language: Language,
): string | null {
  if (!discoveries || discoveries.totalSeconds < RECEIPT_MIN_SECONDS) return null;
  const sources = receiptSources(discoveries, t);
  if (!sources) return null;
  return t("onboarding.preparing.receipt", {
    sources,
    day: t(dayRelation === "yesterday" ? "onboarding.preparing.receiptDayYesterday" : dayRelation === "earlier" ? "onboarding.preparing.receiptDayEarlier" : "onboarding.preparing.receiptDayToday"),
    duration: formatLocalizedCompactDurationFromSeconds(discoveries.totalSeconds, language),
  });
}

type FirstDayPreparationScreenProps = {
  readonly phase: FirstDayPreparationPhase;
  readonly failure?: FirstDayPreparationFailureReason | null;
  readonly onContinueAnyway?: () => void;
  readonly onRetry?: () => void;
  /** 0..1 for a determinate bar, or null while the step has no measurable progress. */
  readonly progress: number | null;
  /** Phases this run expects to go through, so one bar can span all of them. */
  readonly plan?: FirstDayPreparationPlan;
  /** First work activity from onboarding (e.g. "Designing"), used to personalize the classifying copy. */
  readonly workActivityLabel?: string | null;
  /** What the run has found so far in the day being prepared; null before anything has loaded. */
  readonly discoveries?: FirstDayDiscoveries | null;
  /** The loaded part of the day, drawn hour by hour; null before anything has loaded. */
  readonly chart?: FirstDayChart | null;
  /** Which day is being prepared, so the closing line names it ("yesterday" rather than "today"). */
  readonly dayRelation?: "today" | "yesterday" | "earlier";
  readonly appIcons?: AppIconMap;
  /** Sources the in-flight batch sent to the AI provider, largest first; empty between batches. */
  readonly reading?: readonly FirstDaySource[];
};

export function FirstDayPreparationScreen({
  failure = null,
  onContinueAnyway,
  onRetry,
  phase,
  plan = IMPLICIT_PLAN,
  progress,
  workActivityLabel,
  discoveries = null,
  chart = null,
  dayRelation = "today",
  appIcons,
  reading = EMPTY_SOURCES,
}: FirstDayPreparationScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { effectiveLanguage, t } = useLocalization();
  const phaseCopy = useMemo<Record<FirstDayPreparationPhase, PhaseCopy>>(() => ({
    importing: { title: t("onboarding.preparing.importTitle"), lines: [t("onboarding.preparing.importLine1"), t("onboarding.preparing.importLine2")] },
    downloading: { title: t("onboarding.preparing.downloadTitle"), lines: [t("onboarding.preparing.downloadLine1"), t("onboarding.preparing.downloadLine2")] },
    classifying: { title: t("onboarding.preparing.classifyTitle"), lines: [t("onboarding.preparing.classifyLine1"), t("onboarding.preparing.classifyLine2"), t("onboarding.preparing.classifyLine3"), t("onboarding.preparing.classifyLine4")] },
    ready: {
      title: t("onboarding.preparing.readyTitle"),
      lines: [t(dayRelation === "yesterday" ? "onboarding.preparing.readyLineYesterday" : dayRelation === "earlier" ? "onboarding.preparing.readyLineEarlier" : "onboarding.preparing.readyLine")],
    },
  }), [dayRelation, t]);
  const copy = phaseCopy[phase];
  const lines = useMemo(
    () => (phase === "classifying" ? classifyingLines(onboardingActivityLabel(workActivityLabel ?? "", effectiveLanguage), phaseCopy.classifying, t) : phaseCopy[phase].lines),
    [effectiveLanguage, phase, phaseCopy, t, workActivityLabel],
  );
  const line = useRotatingLine(lines, phase);
  const classifying = phase === "classifying";
  const split = useFirstDaySplit(discoveries?.items ?? EMPTY_ITEMS, classifying);
  const readingKeys = useMemo(() => new Set(classifying ? reading.map((source) => source.key) : []), [classifying, reading]);
  const longest = chart?.longestFocus ?? null;
  // A longest focus that just appeared or grew is news worth a moment of the line.
  const freshLongest = useFirstDayFreshKey(longest ? longest.startedAt + ":" + longest.seconds : null, classifying);
  const { determinate, longWait, percent, remaining } = useFirstDayPreparationTrack({ phase, plan, progress });
  const remainingCopy = remainingLabelText(remaining, t);
  const ready = phase === "ready";
  // The line says what is being read, and gives a new fact about the day a moment of its own (a source
  // sorted by context, a longest focus that appeared or grew) before reading returns. Between batches it
  // keeps the latest fact. It never divides Focus and Drift time: the dashboard shows that next.
  const narration: { readonly key: string; readonly content: string } | null = (() => {
    if (ready) {
      const receipt = receiptLine(discoveries, dayRelation, t, effectiveLanguage);
      return receipt ? { key: "receipt", content: receipt } : null;
    }
    if (!classifying) return null;
    const longestCopy = longest
      ? {
        key: "longest:" + longest.startedAt + ":" + longest.seconds,
        content: t("onboarding.preparing.longestSoFar", {
          time: formatLocalizedTimeLabel(longest.startedAt, effectiveLanguage),
          duration: formatLocalizedCompactDurationFromSeconds(longest.seconds, effectiveLanguage),
        }),
      }
      : null;
    const top = discoveries?.items[0];
    const topCopy = top
      ? { key: "top:" + top.key, content: t("onboarding.preparing.topSourceSoFar", { source: firstDaySourceLabel(top.label), duration: formatLocalizedCompactDurationFromSeconds(top.seconds, effectiveLanguage) }) }
      : null;
    if (split) return { key: "split:" + split.key, content: t("onboarding.preparing.contextSplit", { source: firstDaySourceLabel(split.label) }) };
    if (freshLongest && longestCopy) return longestCopy;
    const readingCopy = readingLine(reading, t);
    if (readingCopy) return { key: "reading:" + readingCopy, content: readingCopy };
    return longestCopy ?? topCopy;
  })();
  const readyHighlight = ready && chart?.longestFocus
    ? t("onboarding.preparing.longestFocus", {
      time: formatLocalizedTimeLabel(chart.longestFocus.startedAt, effectiveLanguage),
      duration: formatLocalizedCompactDurationFromSeconds(chart.longestFocus.seconds, effectiveLanguage),
    })
    : null;
  const firstFailureActionRef = useRef<HTMLButtonElement>(null);
  useVerdictFlights(rootRef, discoveries?.items ?? EMPTY_ITEMS);

  useEffect(() => {
    if (failure) firstFailureActionRef.current?.focus();
  }, [failure]);

  if (failure) {
    const detail = failure === "cloud_not_ready"
      ? t("onboarding.preparing.cloudNotReady")
      : failure === "preparation_timed_out"
        ? t("onboarding.preparing.timedOut")
        : t("onboarding.preparing.classificationIncomplete");
    return (
      <div className="first-day-prep">
        <div className="first-day-prep__drag" data-tauri-drag-region />
        <div
          aria-describedby="first-day-prep-failure-detail"
          aria-labelledby="first-day-prep-failure-title"
          aria-modal="true"
          className="first-day-prep__panel"
          role="alertdialog"
        >
          <div className="first-day-prep__mark first-day-prep__mark--paused" aria-hidden="true">
            <span className="first-day-prep__mark-glow" />
            <svg className="first-day-prep__hourglass" viewBox="0 0 1024 1024" width="96" height="96">
              <defs>
                <linearGradient id="firstDayPrepPausedAurora" x1="0.12" y1="0" x2="0.9" y2="1">
                  <stop offset="0" stopColor="#f7b267" />
                  <stop offset="0.5" stopColor="#f4845f" />
                  <stop offset="1" stopColor="#b18cff" />
                </linearGradient>
              </defs>
              <g fill="url(#firstDayPrepPausedAurora)">
                <path d="M266 270h492L512 510z" />
                <path d="M512 514 758 754H266z" />
              </g>
            </svg>
          </div>
          <div className="first-day-prep__copy">
            <h1 className="first-day-prep__title" id="first-day-prep-failure-title">{t("onboarding.preparing.pausedTitle")}</h1>
            <p className="first-day-prep__line" id="first-day-prep-failure-detail">{detail}</p>
          </div>
          <div className="first-day-prep__actions">
            {onRetry ? (
              <button ref={firstFailureActionRef} type="button" className="first-day-prep__action first-day-prep__action--primary" onClick={onRetry}>
                {t("onboarding.preparing.retry")}
              </button>
            ) : null}
            {onContinueAnyway ? (
              <button ref={onRetry ? undefined : firstFailureActionRef} type="button" className="first-day-prep__action" onClick={onContinueAnyway}>
                {t("onboarding.preparing.continue")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="first-day-prep" ref={rootRef} style={{ "--land-delay": FIRST_DAY_LANDING_MS + "ms" } as CSSProperties}>
      <div className="first-day-prep__drag" data-tauri-drag-region />
      <div className="first-day-prep__panel">
        <div className="first-day-prep__hero">
          <FirstDayTokenStage discoveries={discoveries} appIcons={appIcons} readingKeys={readingKeys} />
          <div className={`first-day-prep__mark${ready ? " first-day-prep__mark--ready" : ""}`} aria-hidden="true">
            <span className="first-day-prep__mark-glow" />
            <span className="first-day-prep__mark-tint" />
            <svg className="first-day-prep__hourglass" viewBox="0 0 1024 1024" width="96" height="96" role="img">
              <defs>
                <linearGradient id="firstDayPrepAurora" x1="0.12" y1="0" x2="0.9" y2="1">
                  <stop offset="0" stopColor="#f7b267" />
                  <stop offset="0.5" stopColor="#f4845f" />
                  <stop offset="1" stopColor="#b18cff" />
                </linearGradient>
              </defs>
              {ready ? (
                /* The wait resolves into a check drawn in the same aurora, so the
                   last thing the gate shows is an answer rather than more waiting. */
                <path
                  className="first-day-prep__check"
                  d="M300 530 455 690 730 348"
                  fill="none"
                  stroke="url(#firstDayPrepAurora)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="92"
                />
              ) : (
                /* Drifty hourglass mark: top chamber points down into the neck, bottom chamber rises from it. */
                <g fill="url(#firstDayPrepAurora)">
                  <path d="M266 270h492L512 510z" />
                  <path d="M512 514 758 754H266z" />
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Only the copy is announced. The bar now inches forward continuously,
            so keeping the percentage inside a live region would turn assistive
            output into a stream of numbers; `progressbar` already carries the
            value for anyone who asks for it. */}
        <div className="first-day-prep__copy" role="status" aria-live="polite">
          <h1 className="first-day-prep__title" key={copy.title}>{copy.title}</h1>
          {/* Specific lines change every few seconds while batches land, which is right to look at
              and wrong to hear; only the generic copy and the ready receipt are announced. */}
          {narration ? (
            <p className="first-day-prep__line first-day-prep__line--specific" key={narration.key} aria-live={ready ? undefined : "off"}>{narration.content}</p>
          ) : (
            <p className="first-day-prep__line" key={line}>{line}</p>
          )}
          {/* The one fact the wait earns: the prepared day's longest focus, which the first intro card opens on. */}
          {readyHighlight ? <p className="first-day-prep__highlight">{readyHighlight}</p> : null}
        </div>

        <div
          className={`first-day-prep__progress${determinate ? "" : " first-day-prep__progress--indeterminate"}`}
          role="progressbar"
          aria-label={copy.title}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(determinate ? { "aria-valuenow": percent } : {})}
        >
          <span
            className="first-day-prep__progress-fill"
            style={{ width: `${percent}%` }}
          />
          {determinate ? null : <span className="first-day-prep__progress-sheen" aria-hidden="true" />}
        </div>
        <div className="first-day-prep__meta" aria-hidden="true">
          <span className="first-day-prep__percent">{determinate ? `${percent}%` : t("onboarding.preparing.working")}</span>
          {remainingCopy ? <span className="first-day-prep__remaining">{remainingCopy}</span> : null}
        </div>
        {/* Held back until the wait is long enough to feel wrong: the reassurance
            only helps someone who has started to wonder whether it is stuck. */}
        <p className={`first-day-prep__note${longWait && !ready ? " first-day-prep__note--visible" : ""}`}>
          {t("onboarding.preparing.onceOnly")}
        </p>
      </div>
    </div>
  );
}

function useRotatingLine(lines: readonly string[], resetKey: string): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (lines.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % lines.length);
    }, LINE_ROTATION_MS);
    return () => clearInterval(timer);
  }, [lines, resetKey]);

  return lines[Math.min(index, lines.length - 1)] ?? "";
}
