import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatAchievementDay } from "../../achievementCopy";
import { earlierText, ordinal, railLabels, type RailLabel } from "./c14Copy";

/** Estimated label widths in rem at the rail's type size: month and day, with a year, day only. */
const LABEL_REM: Record<RailLabel["kind"], number> = { month: 3.5, year: 5.5, day: 1.5 };
/** Least space between two neighbouring labels, and the least step between ticks. */
const LABEL_GAP_REM = 0.75;
const MIN_STEP_REM = 2.75;
/** The step between dots once the rail drops its labels. */
const DOT_STEP_REM = 1.5;
/** Room kept for the "earlier" note after the rail. */
const EARLIER_REM = 6;
/** Fewer labelled ticks than this and the rail switches to the newest date followed by even dots. */
const MIN_LABELLED = 3;

/** One even step for the whole rail, wide enough that no two centred labels touch. */
function stepFor(labels: readonly RailLabel[]): number {
  let step = MIN_STEP_REM;
  for (let index = 1; index < labels.length; index += 1) {
    const pair = (LABEL_REM[labels[index - 1].kind] + LABEL_REM[labels[index].kind]) / 2 + LABEL_GAP_REM;
    step = Math.max(step, pair);
  }
  return step;
}

/** How far the first dot sits in, so the newest label, centred on it, starts at the rail's edge. */
function leadFor(labels: readonly RailLabel[], step: number): number {
  const first = labels[0];
  return first ? Math.max(0, LABEL_REM[first.kind] / 2 - step / 2) : 0;
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

function useTicksThatFit(labels: readonly RailLabel[], max: number, total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(() => ({ count: Math.min(max, 6), dots: false }));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const kept = labels.length;
    const step = stepFor(labels);
    const lead = leadFor(labels, step);
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = node.clientWidth / rem;
      const all = Math.floor((width - lead) / step);
      const room = width - (all < kept || total > kept ? EARLIER_REM : 0);
      const count = Math.floor((room - lead) / step);
      const next: Fit = count >= Math.min(MIN_LABELLED, kept)
        ? { count: Math.max(1, Math.min(max, count)), dots: false }
        : { count: Math.max(1, Math.min(max, Math.floor((room - leadFor(labels, DOT_STEP_REM)) / DOT_STEP_REM))), dots: true };
      setFit((prev) => (prev.count === next.count && prev.dots === next.dots ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [labels, max, total]);
  return { ref, fit };
}

/**
 * A row's record as a rail: the latest days newest first as ticks, each a
 * date centred over its mark, one even step apart, naming the month only
 * where it changes. Where few labels fit, only the newest keeps its date and
 * the rest are evenly spaced dots. The rail ends at the last tick; how many came before follows on
 * the same line as a quiet note.
 */
export function C14Ribbon({ days, total, max, gold, onOpenDay, className = "" }: RibbonProps) {
  const { effectiveLanguage, t } = useLocalization();
  const daysKey = days.slice(0, max).join();
  const labels = useMemo(() => railLabels(daysKey ? daysKey.split(",") : [], effectiveLanguage), [daysKey, effectiveLanguage]);
  const { ref, fit } = useTicksThatFit(labels, max, total);
  const shown = labels.slice(0, onOpenDay ? fit.count : max);
  const dots = Boolean(onOpenDay) && fit.dots;
  const rest = total - shown.length;
  const step = dots ? DOT_STEP_REM : stepFor(labels);
  return (
    <div
      ref={ref}
      className={"c14-ribbon " + className}
      data-metal={gold ? "gold" : "silver"}
      data-dots={dots ? "true" : undefined}
      style={{ "--c14-tick": step + "rem", "--c14-lead": leadFor(labels, step) + "rem" } as CSSProperties}
    >
      <ol className="c14-ribbon__ticks" aria-hidden={onOpenDay ? "true" : undefined}>
        {shown.map((label, index) => {
          const day = days[index] ?? "";
          const kind = dots ? "dot" : label.kind;
          const text = dots && index > 0 ? null : <span className="c14-tick__date">{label.text}</span>;
          const mark = (
            <>
              {text}
              <span className="c14-tick__mark" />
            </>
          );
          return (
            <li
              key={day}
              className={"c14-tick c14-tick--" + kind}
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
