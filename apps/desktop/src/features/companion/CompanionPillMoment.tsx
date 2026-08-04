import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import { PillDismissIcon, PillMilestoneKindIcon, PillOpenArrowIcon, PillTrophyIcon } from "./CompanionPillIcons";
import { CompanionPillDayReview } from "./CompanionPillDayReview";

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
};

export type CompanionPillMomentEvent =
  | CompanionPillMilestoneEvent
  | CompanionPillDriftEvent
  | ExtremeNudgeToastEvent
  | EndOfDayReviewEvent;

export type CompanionPillDismissReason = "auto" | "explicit";

const COMPANION_BREAK_OPTIONS = [5, 15, 30, 60] as const;

/** Material guidance for transient messages is 4-10s; the review earns more. */
export const COMPANION_PILL_AUTO_DISMISS_MS: Record<string, number> = {
  milestone: 4_000,
  driftAlarm: 10_000,
  extremeNudgeToast: 8_000,
  endOfDayReview: 12_000,
};

/** Match dwell time to how much there is to read and whether there is a CTA. */
export function resolveCompanionPillAutoDismissMs(event: CompanionPillMomentEvent): number {
  if (event.kind === "milestone") return event.destination ? 6_000 : 4_000;
  if (event.kind === "driftAlarm") return event.mode === "break_return" ? 8_000 : 10_000;
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
const MILESTONE_STAT_LABELS: Record<CompanionPillMilestoneKind, string> = {
  total: "today",
  rank: "today",
  record: "this run",
  recovery: "today",
};

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
): { value: string; label: string } | null {
  if (typeof event.statSeconds !== "number") return null;
  return {
    value: formatMilestoneStat(event.statSeconds),
    label: event.statLabel ?? MILESTONE_STAT_LABELS[event.milestoneKind],
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
  isPointerInside = false,
  isDragging = false,
  onDismiss,
  onOpenDashboard,
  onOpenDestination,
  onAction,
}: {
  event: CompanionPillMomentEvent;
  isActive?: boolean;
  isPointerInside?: boolean;
  isDragging?: boolean;
  onDismiss: (reason: CompanionPillDismissReason) => void;
  onOpenDashboard: () => void;
  onOpenDestination?: (destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => void;
  onAction?: (action: DriftAlarmAction) => void;
}) {
  const [isLocallyHovered, setIsLocallyHovered] = useState(false);
  const budgetMs = resolveCompanionPillAutoDismissMs(event);
  /* Dragging holds the countdown too. AppKit takes the mouse for the whole
     gesture, so hover alone would stop reporting and the card could expire out
     from under the cursor while it was being moved. */
  const isPaused = isLocallyHovered || isPointerInside || isDragging;
  const remainingMsRef = useRef(budgetMs);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive || isPaused) return undefined;
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    const timer = window.setTimeout(() => onDismiss("auto"), remainingMsRef.current);
    return () => {
      window.clearTimeout(timer);
      if (startedAtRef.current === startedAt) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAt));
        startedAtRef.current = null;
      }
    };
  }, [isActive, isPaused, onDismiss]);

  const holdHandlers = {
    onPointerEnter: () => setIsLocallyHovered(true),
    onPointerLeave: () => setIsLocallyHovered(false),
  };
  const autoDismissState = isActive ? (isPaused ? "paused" : "running") : undefined;
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
        />
      </div>
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
        <button className="card__more" type="button" title="Alert settings" aria-label="Open alert settings" onClick={() => onAction?.({ type: "settings" })}>
          <span aria-hidden="true">•••</span>
        </button>
        <button className="card__close card__close--float" type="button" title="Dismiss" onClick={() => onDismiss("explicit")}>
          <PillDismissIcon />
        </button>
        <div className="card__copy">
          <div className="card__title" data-sensitive>{event.title}</div>
          {event.focusLabel ? (
            <div className="card__sub" data-sensitive>
              {"Back in "}
              <b>{event.focusLabel}</b>
            </div>
          ) : null}
        </div>
        <div className="card__actions">
          <CompanionBreakPicker
            label="Take a break"
            options={event.breakOptions?.length ? event.breakOptions : COMPANION_BREAK_OPTIONS}
            onSelect={(minutes) => onAction?.({ type: "start_break", minutes })}
          />
          <button className="act act--quiet" type="button" onClick={() => onAction?.({ type: "manual_correction" })}>
            Not a drift
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
      <button className="card__more" type="button" title="Alert settings" aria-label="Open alert settings" onClick={() => onAction?.({ type: "settings" })}>
        <span aria-hidden="true">•••</span>
      </button>
      <button className="card__close card__close--float" type="button" title="Dismiss" onClick={() => onDismiss("explicit")}>
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
  holdHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
}) {
  const stat = resolveMilestoneStat(event);
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
      {destination && onOpenDestination ? (
        <button
          className="mile__hit"
          type="button"
          data-companion-drag-surface
          aria-label={milestoneDestinationLabel(destination)}
          onClick={() => onOpenDestination(destination)}
        />
      ) : null}
      <span className="mile__mark" aria-hidden="true">
        <span className="orb"><i className="orb__pip" /></span>
        <span className="mile__kind" aria-hidden="true">
          <PillMilestoneKindIcon kind={event.milestoneKind} />
        </span>
        <span className="mile__trophy"><PillTrophyIcon /></span>
      </span>
      <div className="mile__text">
        <div className="mile__title">{event.title}</div>
        <div className="mile__sub"><span className="mile__subtext">{event.subtitle}</span></div>
      </div>
      {stat ? (
        <span className="mile__stat" aria-hidden="true">
          <b className="mile__stat-value">{stat.value}</b>
          <span className="mile__stat-label">{stat.label}</span>
        </span>
      ) : null}
      {destination && onOpenDestination ? (
        <span className="mile__arrow" aria-hidden="true"><PillOpenArrowIcon /></span>
      ) : null}
      <button className="card__close card__close--float" type="button" title="Dismiss" onClick={() => onDismiss("explicit")}>
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
            {minutes}m
          </button>
        ))}
      </span>
    </span>
  );
}

function milestoneDestinationLabel(
  destination: NonNullable<CompanionPillMilestoneEvent["destination"]>,
): string {
  if (destination === "leaderboard") return "Open leaderboard";
  if (destination === "insights") return "Open trends";
  return "Open today's dashboard";
}
