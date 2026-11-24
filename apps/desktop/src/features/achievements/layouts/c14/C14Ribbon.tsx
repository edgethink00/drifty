import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatAchievementDay } from "../../achievementCopy";
import { earlierText, fullLabel, ordinal, railLabels, type RailLabel } from "./c14Copy";

/** One step between dots on every rail, in every row and on the card, whatever the labels say. */
const PITCH_REM = 4;
/** The step between dots once the rail drops its labels. */
const DOT_PITCH_REM = 1.5;
/** Estimated label widths in rem at the rail's type size: month and day, with a year, day only. */
const LABEL_REM: Record<RailLabel["kind"], number> = { month: 3.5, year: 5.5, day: 1.5 };
/** Least space between the end of one label and the start of the next. */
const LABEL_GAP_REM = 0.5;
/** Room kept for the "earlier" note after the rail. */
const EARLIER_REM = 4.5;
/**
 * Fewer labelled ticks than this beside an "earlier" note and the rail switches to the newest date
 * followed by closer dots. The choice depends on the width alone, so every row at one width uses one step.
 */
const MIN_LABELLED = 3;

type Tick = { readonly day: string; readonly label: RailLabel | null };

/**
 * Each label starts at its own dot. A label that would run into the one
 * before it gives way; the next label then names its month again, so a bare
 * day never reads as belonging to the wrong month.
 */
function placeLabels(days: readonly string[], labels: readonly RailLabel[], pitch: number, language: DisplayLanguage): Tick[] {
  let free = 0;
  let skipped = false;
  return labels.map((base, index) => {
    const day = days[index] ?? "";
    const start = index * pitch;
    if (start < free) {
      skipped = true;
      return { day, label: null };
    }
    const label = skipped && base.kind === "day" ? fullLabel(day, language) : base;
    skipped = false;
    free = start + LABEL_REM[label.kind] + LABEL_GAP_REM;
    return { day, label };
  });
}

type RibbonProps = {
  /** Kept days, newest first. */
  readonly days: readonly string[];
  /** Every time it was earned, kept days and earlier ones together. */
  readonly total: number;
  /** Most ticks to draw; the tab draws as many as fit up to this. */
  readonly max: number;
  readonly gold: boolean;
  /** Open a day from its tick (the tab); the card draws plain marks. */
  readonly onOpenDay?: (day: string) => void;
  readonly className?: string;
};

type Fit = { readonly count: number; readonly dots: boolean };

function useTicksThatFit(kept: number, max: number, total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(() => ({ count: Math.min(max, 4), dots: false }));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = node.clientWidth / rem;
      const all = Math.floor(width / PITCH_REM);
      const room = width - (all < kept || total > kept ? EARLIER_REM : 0);
      const count = Math.floor(room / PITCH_REM);
      const next: Fit = Math.floor((width - EARLIER_REM) / PITCH_REM) >= MIN_LABELLED
        ? { count: Math.max(1, Math.min(max, count)), dots: false }
        : { count: Math.max(1, Math.min(max, Math.floor(room / DOT_PITCH_REM))), dots: true };
      setFit((prev) => (prev.count === next.count && prev.dots === next.dots ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [kept, max, total]);
  return { ref, fit };
}

/**
 * A row's record as a rail: the latest days newest first as dots one fixed
 * step apart, the first dot at the rail's start in every row. Each date
 * starts at its dot and names the month only where it changes. Where few
 * labels fit, only the newest keeps its date and the rest are closer dots.
 * The rail ends at the last dot; how many came before follows on the same
 * line as a quiet note.
 */
export function C14Ribbon({ days, total, max, gold, onOpenDay, className = "" }: RibbonProps) {
  const { effectiveLanguage, t } = useLocalization();
  const daysKey = days.slice(0, max).join();
  const keptDays = useMemo(() => (daysKey ? daysKey.split(",") : []), [daysKey]);
  const labels = useMemo(() => railLabels(keptDays, effectiveLanguage), [keptDays, effectiveLanguage]);
  const { ref, fit } = useTicksThatFit(labels.length, max, total);
  const dots = Boolean(onOpenDay) && fit.dots;
  const pitch = dots ? DOT_PITCH_REM : PITCH_REM;
  const ticks = useMemo(
    () => (dots
      ? keptDays.map((day, index) => ({ day, label: index === 0 ? labels[0] ?? null : null }))
      : placeLabels(keptDays, labels, PITCH_REM, effectiveLanguage)),
    [dots, keptDays, labels, effectiveLanguage],
  );
  const shown = ticks.slice(0, onOpenDay ? fit.count : max);
  const rest = total - shown.length;
  return (
    <div
      ref={ref}
      className={"c14-ribbon " + className}
      data-metal={gold ? "gold" : "silver"}
      data-dots={dots ? "true" : undefined}
      style={{ "--c14-tick": pitch + "rem" } as CSSProperties}
    >
      <ol className="c14-ribbon__ticks" aria-hidden={onOpenDay ? "true" : undefined}>
        {shown.map(({ day, label }, index) => {
          const mark = (
            <>
              {label ? <span className="c14-tick__date">{label.text}</span> : null}
              <span className="c14-tick__mark" />
            </>
          );
          return (
            <li
              key={day}
              className={"c14-tick c14-tick--" + (dots ? "dot" : label?.kind ?? "bare")}
              data-newest={index === 0 ? "true" : undefined}
            >
              {onOpenDay ? (
                <button
                  type="button"
                  className="c14-tick__hit"
                  tabIndex={-1}
                  title={ordinal(total - index, t, effectiveLanguage) + " · " + formatAchievementDay(day, effectiveLanguage)}
                  onClick={() => onOpenDay(day)}
                >
                  {mark}
                </button>
              ) : (
                <span className="c14-tick__hit">{mark}</span>
              )}
            </li>
          );
        })}
      </ol>
      {rest > 0 ? <span className="c14-ribbon__earlier" aria-hidden={onOpenDay ? "true" : undefined}>{earlierText(rest, t)}</span> : null}
    </div>
  );
}
