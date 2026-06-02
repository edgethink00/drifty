import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActivityCategory, ProductivityLabel } from "@dtime/domain";

export type WatcherFocusSessionKind = "just_started" | "settled" | "deep" | "recovered";
export type WatcherDriftPattern = "first" | "repeated" | "after_snooze" | "long";

export type WatcherPeekEvent = {
  id: number;
  productivity: ProductivityLabel;
  category: ActivityCategory;
  contextLabel: string;
  durationLabel: string;
  durationSeconds: number;
  slotIndex: number;
  focusSessionKind: WatcherFocusSessionKind;
  driftPattern: WatcherDriftPattern;
  driftReminderElapsedSeconds: number | null;
  recentWatcherResponse: WatcherPeekResponse | null;
  minutesSinceLastWatcher: number | null;
  focusSecondsToday: number;
  currentHourFocusSeconds: number;
};

export type WatcherPeekResponse = "return" | "snooze" | "dismiss";

export type WatcherPhase = "hidden" | "peeking" | "watching" | "deciding" | "speaking" | "leaving";
type WatcherEdge = "left" | "right" | "bottom";

type WatcherPresence = "encouraging" | "checking" | "interrupting";

type WatcherTiming = {
  watchingAtMs: number;
  decidingAtMs: number;
  speakingAtMs: number;
  leavingAtMs: number;
  dismissAtMs: number;
};

type WatcherSlot = {
  edge: WatcherEdge;
  offset: string;
};

const WATCHER_SLOTS: WatcherSlot[] = [
  { edge: "bottom", offset: "50%" },
];

const WATCHER_TIMINGS: Record<ProductivityLabel, WatcherTiming> = {
  focus: {
    watchingAtMs: 700,
    decidingAtMs: 1_400,
    speakingAtMs: 2_200,
    leavingAtMs: 8_500,
    dismissAtMs: 9_300,
  },
  neutral: {
    watchingAtMs: 720,
    decidingAtMs: 1_650,
    speakingAtMs: 2_400,
    leavingAtMs: 12_000,
    dismissAtMs: 12_600,
  },
  drift: {
    watchingAtMs: 520,
    decidingAtMs: 1_450,
    speakingAtMs: 2_300,
    leavingAtMs: 18_000,
    dismissAtMs: 18_800,
  },
};

type WatcherCopy = {
  eyebrow: string;
  title: string;
  body: string;
};

export function WatcherPeek({
  event,
  onDismiss,
  onPhaseChange,
}: {
  event: WatcherPeekEvent | null;
  onDismiss: () => void;
  onRespond?: (response: WatcherPeekResponse) => void;
  onPhaseChange?: (phase: WatcherPhase, event: WatcherPeekEvent | null) => void;
}) {
  const [phase, setPhase] = useState<WatcherPhase>("hidden");
  const isCardActive = phase === "speaking" || phase === "leaving";

  useEffect(() => {
    if (!event) {
      setPhase("hidden");
      onPhaseChange?.("hidden", null);
      return;
    }

    setPhase("peeking");
    onPhaseChange?.("peeking", event);
    const timing = getWatcherTiming(event.productivity);
    const timers = [
      window.setTimeout(() => {
        setPhase("watching");
        onPhaseChange?.("watching", event);
      }, timing.watchingAtMs),
      window.setTimeout(() => {
        setPhase("deciding");
        onPhaseChange?.("deciding", event);
      }, timing.decidingAtMs),
      window.setTimeout(() => {
        setPhase("speaking");
        onPhaseChange?.("speaking", event);
      }, timing.speakingAtMs),
      window.setTimeout(() => {
        setPhase("leaving");
        onPhaseChange?.("leaving", event);
      }, timing.leavingAtMs),
      window.setTimeout(onDismiss, timing.dismissAtMs),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [event?.id, event?.productivity, onDismiss, onPhaseChange]);

  const slot = useMemo(() => {
    if (!event) return WATCHER_SLOTS[0];
    return WATCHER_SLOTS[event.slotIndex % WATCHER_SLOTS.length];
  }, [event]);

  if (!event) return null;

  const copy = getWatcherCopy(event);
  const presence = getWatcherPresence(event.productivity);
  const slotStyle = { "--watcher-offset": slot.offset } as CSSProperties;

  return (
    <aside
      className={`watcher-peek watcher-peek--${slot.edge}`}
      data-phase={phase}
      data-mood={event.productivity}
      data-presence={presence}
      style={slotStyle}
      aria-label="Drifty watcher check-in"
      aria-live="polite"
    >
      <div className="watcher-peek__stage">
        <div className="watcher-peek__orb" aria-hidden="true">
          <span className="watcher-peek__orb-shadow" />
          <span className="watcher-peek__orb-halo" />
          <span className="watcher-peek__orb-ring watcher-peek__orb-ring--outer" />
          <span className="watcher-peek__orb-ring watcher-peek__orb-ring--inner" />
          <span className="watcher-peek__orb-core">
            <span className="watcher-peek__orb-glow" />
            <span className="watcher-peek__orb-glint watcher-peek__orb-glint--one" />
            <span className="watcher-peek__orb-glint watcher-peek__orb-glint--two" />
          </span>
          <span className="watcher-peek__signal watcher-peek__signal--one" />
          <span className="watcher-peek__signal watcher-peek__signal--two" />
          <span className="watcher-peek__signal watcher-peek__signal--three" />
          <span className="watcher-peek__signal watcher-peek__signal--four" />
        </div>
        <section className="watcher-peek__card" aria-hidden={!isCardActive}>
          <span className="watcher-peek__eyebrow">{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </section>
      </div>
    </aside>
  );
}

function getWatcherTiming(productivity: ProductivityLabel): WatcherTiming {
  return WATCHER_TIMINGS[productivity] ?? WATCHER_TIMINGS.neutral;
}

function getWatcherPresence(productivity: ProductivityLabel): WatcherPresence {
  if (productivity === "focus") return "encouraging";
  if (productivity === "drift") return "interrupting";
  return "checking";
}

function getWatcherCopy(event: WatcherPeekEvent): WatcherCopy {
  const place = event.contextLabel || "this session";
  const scenario = selectWatcherScenario(event);

  if (event.productivity === "drift" && event.driftReminderElapsedSeconds !== null) {
    const elapsed = formatDriftReminderElapsed(event.driftReminderElapsedSeconds);
    return {
      eyebrow: "Drift check",
      title: `${elapsed} passed.`,
      body: `${elapsed} around ${place}. If this is not helping, it may be time to move on.`,
    };
  }

  if (scenario === "focus_just_started") {
    return {
      eyebrow: "Quiet watch",
      title: "You got in.",
      body: `${event.durationLabel} around ${place}. I saw the switch happen, so I’ll stay out of it.`,
    };
  }

  if (scenario === "focus_deep") {
    return {
      eyebrow: "Deep focus",
      title: "Keep going. Don’t break this.",
      body: `${event.durationLabel} in ${place}. This is the kind of run I should not interrupt.`,
    };
  }

  if (scenario === "focus_recovered") {
    return {
      eyebrow: "Back on track",
      title: "I saw you come back.",
      body: `${event.durationLabel} focused again. Good recovery. I’ll disappear now.`,
    };
  }

  if (scenario === "drift_after_snooze") {
    return {
      eyebrow: "Still watching",
      title: "You asked for 5.",
      body: `${event.durationLabel} around ${place}. That break is turning into a pattern, so pick the next move.`,
    };
  }

  if (scenario === "drift_repeated") {
    return {
      eyebrow: "Pattern caught",
      title: "Same drift again.",
      body: `${event.durationLabel} around ${place}. I’ve seen this loop recently; decide if it stays.`,
    };
  }

  if (scenario === "drift_long") {
    return {
      eyebrow: "Still watching",
      title: "This one is getting long.",
      body: `${event.durationLabel} around ${place}. I’ll stay visible for a bit so you can choose what happens next.`,
    };
  }

  if (event.productivity === "focus") {
    return {
      eyebrow: "Quiet watch",
      title: "Keep going. Stay with it.",
      body: `${event.durationLabel} focused around ${place}. I saw enough. I’ll disappear now.`,
    };
  }

  if (event.productivity === "drift") {
    return {
      eyebrow: "Still watching",
      title: "Hey. This is drift.",
      body: `${event.durationLabel} around ${place}. I’ll stay visible for a bit so you can choose what happens next.`,
    };
  }

  return {
    eyebrow: "Session check",
    title: "Is this part of your work?",
    body: `I’ve seen ${place} for ${event.durationLabel}. Mark it as work and I’ll stay quiet next time.`,
  };
}

function formatDriftReminderElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 60) return "1 hour";
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function selectWatcherScenario(event: WatcherPeekEvent): string {
  if (event.productivity === "focus") {
    if (event.focusSessionKind === "recovered") return "focus_recovered";
    if (event.focusSessionKind === "just_started") return "focus_just_started";
    if (event.focusSessionKind === "deep") return "focus_deep";
    return "focus_settled";
  }

  if (event.productivity === "drift") {
    if (event.driftPattern === "after_snooze") return "drift_after_snooze";
    if (event.driftPattern === "repeated") return "drift_repeated";
    if (event.driftPattern === "long") return "drift_long";
    return "drift_first";
  }

  return event.minutesSinceLastWatcher === null ? "neutral_first" : "neutral_check";
}
