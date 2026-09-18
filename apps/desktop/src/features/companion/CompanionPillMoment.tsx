import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import {
  DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS,
  type DriftAlarmAction,
  type DriftAlarmCorrectionStatus,
} from "./driftAlarmEvent";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { EXTREME_NUDGE_TOAST_VISIBLE_MS } from "./extremeNudgeTiming";
import {
  PillDismissIcon,
  PillFeedbackCheckIcon,
  PillMilestoneKindIcon,
  PillOpenArrowIcon,
  PillTrophyIcon,
} from "./CompanionPillIcons";
import { CompanionPillDayReview } from "./CompanionPillDayReview";
import { isCompanionMomentStale } from "./companionMomentFreshness";

/**
 * Moments the pill grows into.
 *
 * Each one auto-dismisses on a budget sized to how much there is to read and
 * whether a decision is required. Hovering pauses the countdown so a card never
 * disappears out from under the pointer.
 */

export type CompanionPillMilestoneKind = "total" | "record" | "recovery" | "rank";

export type CompanionPillMilestoneEvent = {
  kind: "milestone";
  id: string;
  milestoneKind: CompanionPillMilestoneKind;
  tier: 1 | 2 | 3;
  title: string;
  subtitle: string;
  /** Where the win leads. Recovery has none: it is a moment, not a page. */
  destination: "leaderboard" | "insights" | "dashboard" | null;
  /**
   * The measured figure the headline is claiming, in seconds, printed beside it
   * when the source event carries one. Which clock it refers to depends on the kind: a
   * daily total and a leaderboard place are about the day, a record is about
   * the run that just beat it. Omitted when there is no honest number, as with
   * pulling yourself back on your own.
   */
  statSeconds?: number | null;
  /** Overrides the kind default for weekly or other non-daily figures. */
  statLabel?: string | null;
  /** When the win was earned; drives staleness so a celebration cannot
      survive a sleep cycle and greet the user about yesterday. */
  generatedAt?: string;
};

export type CompanionPillDriftEvent = {
  kind: "driftAlarm";
  /** Break-return cards are simpler than active drift decisions. */
  mode?: "drift" | "break_return";
  id: string;
  title: string;
  summary: string;
  returnLabel: string;
  returnTargetId: string | null;
  breakLabel: string;
  correctionLabel: string;
  correctionStatus?: DriftAlarmCorrectionStatus;
  /** When the alarm fired; drives staleness so a drift card cannot survive
      a sleep cycle and describe a session that ended hours ago. */
  generatedAt?: string;
};

export type CompanionPillMomentEvent =
  | CompanionPillMilestoneEvent
  | CompanionPillDriftEvent
  | ExtremeNudgeToastEvent
  | EndOfDayReviewEvent;

export type CompanionPillDismissReason = "auto" | "explicit";

const COMPANION_BREAK_OPTIONS = [5, 15, 30, 60] as const;
const COMPANION_BREAK_RETURN_AUTO_DISMISS_MS = 12_500;

/** Informational cards stay short; decision cards leave enough time to act without lingering. */
export const COMPANION_PILL_AUTO_DISMISS_MS: Record<string, number> = {
  milestone: 4_000,
  driftAlarm: 9_000,
  extremeNudgeToast: EXTREME_NUDGE_TOAST_VISIBLE_MS,
  endOfDayReview: 12_000,
};

/** Match dwell time to how much there is to read and whether there is a CTA. */
export function resolveCompanionPillAutoDismissMs(event: CompanionPillMomentEvent): number {
  if ((event.kind === "driftAlarm" || event.kind === "extremeNudgeToast") && event.correctionStatus) {
    return DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS;
  }
  if (event.kind === "milestone") return event.destination ? 6_000 : 4_000;
  if (event.kind === "driftAlarm") {
    return event.mode === "break_return"
      ? COMPANION_BREAK_RETURN_AUTO_DISMISS_MS
      : COMPANION_PILL_AUTO_DISMISS_MS.driftAlarm;
  }
  if (event.kind === "endOfDayReview") {
    if (event.layout === "full") return 12_000;
    return event.layout === "compact" ? 10_000 : 8_000;
  }
  return COMPANION_PILL_AUTO_DISMISS_MS[event.kind] ?? 8_000;
}

/* Celebration scales with how rare the achievement is, so a daily 1h and a
   30-day record never feel the same. Tier 1 emits bare sparks positioned by the
   stylesheet; tiers 2 and 3 launch confetti whose spread, palette and shape mix
   are generated here, matching the prototype's `buildConfetti`. */
const CONFETTI_COLORS = ["var(--accent)", "var(--accent-strong)", "var(--gold)", "var(--blue)"];
const GOLD_COLORS = ["#c9a24f", "#e2c078", "#b98a2e", "var(--accent)"];

/** How far a piece may travel from where it spawns, per tier.
 *
 * Bounded by the window's transparent gutter (COMPANION_PILL_GUTTER_X / _Y in
 * watcher.rs): a native window cannot paint past its own frame, so anything
 * larger is simply cut off mid-flight. Vertical reach works out smaller because
 * the burst is flattened to 0.55 and nudged 10px up.
 */
const COMPANION_PILL_CONFETTI_SPREAD: Record<1 | 2 | 3, number> = { 1: 0, 2: 66, 3: 78 };

/** What the figure beside a milestone headline refers to, per kind. */
const MILESTONE_STAT_LABEL_KEYS = {
  total: "companion.milestone.statToday",
  rank: "companion.milestone.statToday",
  record: "companion.milestone.statThisRun",
  recovery: "companion.milestone.statToday",
} as const satisfies Record<CompanionPillMilestoneKind, TranslationKey>;

/**
 * h:mm once past an hour, "42m" below it.
 *
 * A bare "0:42" would read as minutes and seconds on a surface where the
 * resting pill already shows 2:41 meaning hours and minutes.
 */
function formatMilestoneStat(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes}m`;
}

function resolveMilestoneStat(
  event: CompanionPillMilestoneEvent,
  t: LocalizationController["t"],
): { value: string; label: string } | null {
  if (typeof event.statSeconds !== "number") return null;
  return {
    value: formatMilestoneStat(event.statSeconds),
    label: event.statLabel ?? t(MILESTONE_STAT_LABEL_KEYS[event.milestoneKind]),
  };
}

/* The burst is random by design, but it is drawn from a seed derived from the
   milestone id so a re-render repositions nothing mid-celebration. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function hashSeed(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildMilestoneSparks(tier: 1 | 2 | 3, seed: string): CSSProperties[] {
  const count = tier === 3 ? 26 : tier === 2 ? 16 : 6;
  if (tier === 1) return Array.from({ length: count }, () => ({}) as CSSProperties);

  const random = seededRandom(hashSeed(seed));
  const spread = COMPANION_PILL_CONFETTI_SPREAD[tier];
  const palette = tier === 3 ? GOLD_COLORS : CONFETTI_COLORS;

  return Array.from({ length: count }, (_unused, index) => {
    const angle = (Math.PI * 2 * index) / count + random() * 0.4;
    const distance = spread * (0.45 + random() * 0.55);
    /* Mix dots and ribbons so the burst reads as confetti, not dust. */
    const isRibbon = index % 3 !== 0;
    return {
      "--cx": `${Math.cos(angle) * distance}px`,
      "--cy": `${Math.sin(angle) * distance * 0.55 - 10}px`,
      "--rot": `${Math.round(120 + random() * 380)}deg`,
      "--c": palette[index % palette.length],
      "--w": isRibbon ? "3px" : "5px",
      "--h": isRibbon ? "7px" : "5px",
      "--r": isRibbon ? "1px" : "50%",
      left: `${(tier === 3 ? 45 : 30) + random() * 12}%`,
      animationDelay: `${(random() * 0.22).toFixed(2)}s`,
    } as CSSProperties;
  });
}

export function CompanionPillMoment({
  event,
  isActive = true,
  autoDismissEnabled = true,
  isPointerInside = false,
  isDragging = false,
  onDismiss,
  onOpenDashboard,
  onOpenAiSettings,
  onOpenDestination,
  onAction,
}: {
  event: CompanionPillMomentEvent;
  isActive?: boolean;
  autoDismissEnabled?: boolean;
  isPointerInside?: boolean;
  isDragging?: boolean;
  onDismiss: (reason: CompanionPillDismissReason) => void;
  onOpenDashboard: () => void;
  onOpenAiSettings?: () => void;
  onOpenDestination?: (destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => void;
  onAction?: (action: DriftAlarmAction) => void;
}) {
  const { t } = useLocalization();
  const [isLocallyHovered, setIsLocallyHovered] = useState(false);
  const [isKeyboardFocusWithin, setIsKeyboardFocusWithin] = useState(false);
  const isPointerOriginFocusRef = useRef(false);
  const budgetMs = resolveCompanionPillAutoDismissMs(event);
  /* Dragging holds the countdown too. AppKit takes the mouse for the whole
     gesture, so hover alone would stop reporting and the card could expire out
     from under the cursor while it was being moved. */
  const isCorrectionFeedback = (event.kind === "driftAlarm" || event.kind === "extremeNudgeToast")
    && event.correctionStatus !== undefined;
  /* The acknowledgement replaces the button under the pointer. If ordinary
     hover pausing carried across that replacement, a short confirmation would
     remain forever until the user happened to move the mouse. It has no
     decision to protect, so only an active drag may pause this short state. */
  const isPaused = isDragging
    || (!isCorrectionFeedback && (isLocallyHovered || isKeyboardFocusWithin || isPointerInside));
  const remainingMsRef = useRef(budgetMs);
  const startedAtRef = useRef<number | null>(null);
  const autoDismissResetKey = correctionAutoDismissResetKey(event);

  useEffect(() => {
    remainingMsRef.current = budgetMs;
    startedAtRef.current = null;
  }, [autoDismissResetKey, budgetMs]);

  /* Wall-clock expiry, independent of the pauseable budget: the budget freezes
     with the machine, so without this a card fired seconds before sleep would
     still be "fresh" at the next lid-open hours later. Stale moments are
     consumed silently; producers rebuild them on the next evaluation. */
  useEffect(() => {
    if (!isActive || !autoDismissEnabled) return undefined;
    if (isCompanionMomentStale(event)) {
      onDismiss("auto");
      return undefined;
    }
    const interval = window.setInterval(() => {
      if (isCompanionMomentStale(event)) onDismiss("auto");
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [autoDismissEnabled, event, isActive, onDismiss]);

  useEffect(() => {
    if (!isActive || !autoDismissEnabled || isPaused) return undefined;
    /* Wall-clock time can move backwards when macOS corrects its clock or
       resumes from sleep. A negative elapsed duration used to add time back to
       the card exactly when hover paused it. performance.now() is monotonic,
       and the clamp keeps even a broken fallback clock from increasing the
       remaining budget. */
    const startedAt = monotonicNowMs();
    startedAtRef.current = startedAt;
    const timer = window.setTimeout(() => onDismiss("auto"), remainingMsRef.current);
    return () => {
      window.clearTimeout(timer);
      if (startedAtRef.current === startedAt) {
        const elapsedMs = Math.max(0, monotonicNowMs() - startedAt);
        remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsedMs);
        startedAtRef.current = null;
      }
    };
  }, [autoDismissEnabled, autoDismissResetKey, budgetMs, isActive, isPaused, onDismiss]);

  const holdHandlers = {
    onPointerEnter: () => setIsLocallyHovered(true),
    onPointerLeave: () => setIsLocallyHovered(false),
    onMouseDownCapture: () => {
      isPointerOriginFocusRef.current = true;
    },
    onPointerDownCapture: () => {
      isPointerOriginFocusRef.current = true;
    },
    onFocusCapture: () => {
      if (!isPointerOriginFocusRef.current) setIsKeyboardFocusWithin(true);
    },
    onBlurCapture: (focusEvent: FocusEvent<HTMLElement>) => {
      const nextTarget = focusEvent.relatedTarget;
      if (nextTarget instanceof Node && focusEvent.currentTarget.contains(nextTarget)) return;
      isPointerOriginFocusRef.current = false;
      setIsKeyboardFocusWithin(false);
    },
    onKeyDownCapture: (keyboardEvent: KeyboardEvent<HTMLElement>) => {
      if (keyboardEvent.key === "Tab") isPointerOriginFocusRef.current = false;
    },
  };
  const autoDismissState = isActive && autoDismissEnabled ? (isPaused ? "paused" : "running") : undefined;
  const autoDismissStyle = {
    "--auto-duration": `${budgetMs}ms`,
    "--auto-start-scale": 1,
  } as CSSProperties;

  if (event.kind === "milestone") {
    return (
      <MilestoneView
        event={event}
        isActive={isActive}
        autoDismissState={autoDismissState}
        autoDismissStyle={autoDismissStyle}
        onDismiss={onDismiss}
        onOpenDestination={onOpenDestination}
        holdHandlers={holdHandlers}
      />
    );
  }

  if (event.kind === "endOfDayReview") {
    return (
      <div
        className={`view view--eod card${isActive ? " is-active" : ""}`}
        data-view="eod"
        data-auto={autoDismissState}
        aria-hidden={!isActive}
        style={autoDismissStyle}
        {...holdHandlers}
      >
        <CompanionPillDayReview
          event={event}
          onDismiss={() => onDismiss("explicit")}
          onOpenDashboard={onOpenDashboard}
          onOpenAiSettings={onOpenAiSettings}
        />
      </div>
    );
  }

  if (event.correctionStatus) {
    return (
      <DriftCorrectionFeedbackView
        status={event.correctionStatus}
        isActive={isActive}
        autoDismissState={autoDismissState}
        autoDismissStyle={autoDismissStyle}
        onDismiss={onDismiss}
        holdHandlers={holdHandlers}
      />
    );
  }

  if (event.kind === "extremeNudgeToast") {
    return (
      <div
        className={`view view--nudge card card--float-close${isActive ? " is-active" : ""}`}
        data-view="nudge"
        data-auto={autoDismissState}
        aria-hidden={!isActive}
        style={autoDismissStyle}
        {...holdHandlers}
      >
        <button className="card__more" type="button" title={t("companion.card.alertSettings")} aria-label={t("companion.card.openAlertSettings")} onClick={() => onAction?.({ type: "settings" })}>
          <span aria-hidden="true">•••</span>
        </button>
        <button className="card__close card__close--float" type="button" title={t("companion.card.dismiss")} onClick={() => onDismiss("explicit")}>
          <PillDismissIcon />
        </button>
        <div className="card__copy">
          <div className="card__title" data-sensitive>{event.title}</div>
          {event.focusLabel ? (
            <div className="card__sub" data-sensitive>
              {t("companion.card.backIn")}{" "}
              <b>{event.focusLabel}</b>
            </div>
          ) : null}
        </div>
        <div className="card__actions">
          <CompanionBreakPicker
            label={event.breakLabel ?? t("companion.copy.takeBreakLabel")}
            options={event.breakOptions?.length ? event.breakOptions : COMPANION_BREAK_OPTIONS}
            onSelect={(minutes) => onAction?.({ type: "start_break", minutes })}
          />
          <button className="act act--quiet" type="button" onClick={() => onAction?.({ type: "manual_correction" })}>
            {event.correctionLabel ?? t("companion.copy.manualCorrectionLabel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`view view--drift card card--float-close${isActive ? " is-active" : ""}`}
      data-view="drift"
      data-auto={autoDismissState}
      aria-hidden={!isActive}
      style={autoDismissStyle}
      {...holdHandlers}
    >
      <button className="card__more" type="button" title={t("companion.card.alertSettings")} aria-label={t("companion.card.openAlertSettings")} onClick={() => onAction?.({ type: "settings" })}>
        <span aria-hidden="true">•••</span>
      </button>
      <button className="card__close card__close--float" type="button" title={t("companion.card.dismiss")} onClick={() => onDismiss("explicit")}>
        <PillDismissIcon />
      </button>
      <div className="card__copy">
        <div className="card__title" data-sensitive>{event.title}</div>
        <div className="card__sub" data-sensitive>{event.summary}</div>
      </div>
      <div className="card__actions">
        <button
          className="act act--primary"
          type="button"
          onClick={() => {
            if (event.returnTargetId) onAction?.({ type: "return_to_focus", targetId: event.returnTargetId });
            else onOpenDashboard();
          }}
        >
          {event.returnLabel}
        </button>
        <CompanionBreakPicker
          label={event.breakLabel}
          options={COMPANION_BREAK_OPTIONS}
          onSelect={(minutes) => onAction?.({ type: "start_break", minutes })}
        />
        <button className="act act--quiet" type="button" onClick={() => onAction?.({ type: "manual_correction" })}>
          {event.correctionLabel}
        </button>
      </div>
    </div>
  );
}

function DriftCorrectionFeedbackView({
  status,
  isActive,
  autoDismissState,
  autoDismissStyle,
  onDismiss,
  holdHandlers,
}: {
  status: DriftAlarmCorrectionStatus;
  isActive: boolean;
  autoDismissState: "running" | "paused" | undefined;
  autoDismissStyle: CSSProperties;
  onDismiss: (reason: CompanionPillDismissReason) => void;
  holdHandlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onMouseDownCapture: () => void;
    onPointerDownCapture: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
  };
}) {
  const { t } = useLocalization();
  return (
    <div
      className={`view view--drift view--drift-feedback card card--float-close${isActive ? " is-active" : ""}`}
      data-view="drift-feedback"
      data-correction-state={status}
      data-auto={autoDismissState}
      aria-hidden={!isActive}
      aria-live="polite"
      role="status"
      style={autoDismissStyle}
      {...holdHandlers}
    >
      <button className="card__close card__close--float" type="button" title={t("companion.card.dismiss")} onClick={() => onDismiss("explicit")}>
        <PillDismissIcon />
      </button>
      <div className="drift-feedback__body">
        <span className="drift-feedback__mark" aria-hidden="true">
          <PillFeedbackCheckIcon />
        </span>
        <div className="card__copy">
          <div className="card__title">{t("companion.card.correctionTitle")}</div>
          <div className="card__sub drift-feedback__subtitle">{t("companion.card.correctionSubtitle")}</div>
        </div>
      </div>
    </div>
  );
}

function monotonicNowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function correctionAutoDismissResetKey(event: CompanionPillMomentEvent): string {
  if (event.kind === "driftAlarm" || event.kind === "extremeNudgeToast") {
    return `${event.kind}:${event.id}:${event.correctionStatus ?? "idle"}`;
  }
  return `${event.kind}:${"id" in event ? event.id : event.generatedAt}`;
}

function MilestoneView({
  event,
  isActive,
  autoDismissState,
  autoDismissStyle,
  onDismiss,
  onOpenDestination,
  holdHandlers,
}: {
  event: CompanionPillMilestoneEvent;
  isActive: boolean;
  autoDismissState: "running" | "paused" | undefined;
  autoDismissStyle: CSSProperties;
  onDismiss: (reason: CompanionPillDismissReason) => void;
  onOpenDestination?: (destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => void;
  holdHandlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onMouseDownCapture: () => void;
    onPointerDownCapture: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
  };
}) {
  const { t } = useLocalization();
  const stat = resolveMilestoneStat(event, t);
  const destination = event.destination;
  return (
    <div
      className={`view view--milestone${isActive ? " is-active" : ""}`}
      data-view="milestone"
      data-auto={autoDismissState}
      aria-hidden={!isActive}
      style={autoDismissStyle}
      {...holdHandlers}
    >
      <span className="mile__mark" aria-hidden="true">
        <span className="orb"><i className="orb__pip" /></span>
        <span className="mile__kind" aria-hidden="true">
          <PillMilestoneKindIcon kind={event.milestoneKind} />
        </span>
        <span className="mile__trophy"><PillTrophyIcon /></span>
      </span>
      <div className="mile__text">
        <div className="mile__title-row">
          <div className="mile__title">{event.title}</div>
          {stat ? (
            <span className="mile__stat" aria-label={`${stat.value} ${stat.label}`}>
              {stat.value}
            </span>
          ) : null}
        </div>
        <div className="mile__sub"><span className="mile__subtext">{event.subtitle}</span></div>
      </div>
      {destination && onOpenDestination ? (
        <button
          className="mile__action"
          type="button"
          data-companion-drag-surface
          aria-label={milestoneDestinationLabel(destination, t)}
          onClick={() => onOpenDestination(destination)}
        >
          <span>{milestoneDestinationActionLabel(destination, t)}</span>
          <PillOpenArrowIcon />
        </button>
      ) : null}
      <button className="card__close card__close--float" type="button" title={t("companion.card.dismiss")} onClick={() => onDismiss("explicit")}>
        <PillDismissIcon />
      </button>
    </div>
  );
}

function CompanionBreakPicker({
  label,
  options,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly number[];
  readonly onSelect: (minutes: number) => void;
}) {
  const { t } = useLocalization();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <span className={`brk${isOpen ? " is-open" : ""}`}>
      <button
        className="act brk__trigger"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        {label}
      </button>
      <span className="brk__opts" aria-hidden={!isOpen}>
        {options.map((minutes) => (
          <button
            key={minutes}
            className="brk__opt"
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => onSelect(minutes)}
          >
            {t("companion.card.breakMinutes", { minutes })}
          </button>
        ))}
      </span>
    </span>
  );
}

function milestoneDestinationLabel(
  destination: NonNullable<CompanionPillMilestoneEvent["destination"]>,
  t: LocalizationController["t"],
): string {
  if (destination === "leaderboard") return t("companion.milestone.openLeaderboard");
  if (destination === "insights") return t("companion.milestone.openInsights");
  return t("companion.milestone.openDashboard");
}

function milestoneDestinationActionLabel(
  destination: NonNullable<CompanionPillMilestoneEvent["destination"]>,
  t: LocalizationController["t"],
): string {
  if (destination === "leaderboard") return t("companion.milestone.viewRank");
  if (destination === "insights") return t("companion.milestone.viewInsights");
  return t("companion.milestone.viewDay");
}
