import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatAchievementDay } from "../../achievementCopy";
import { earlierText, ordinal, railLabels, type RailLabel } from "./c14Copy";

/** Tick widths in rem by label: month and day, one that also carries a year, day only, a dot. */
const WIDTH_REM: Record<RailLabel["kind"] | "dot", number> = { month: 4.5, year: 7, day: 2.5, dot: 1.5 };
/** Room kept for the "earlier" note after the rail. */
const EARLIER_REM = 5.5;
/** Fewer labelled ticks than this and the rail switches to the newest date followed by even dots. */
const MIN_LABELLED = 3;

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
  /** A line set under the newest tick (the card's "19번째"). */
  readonly newestNote?: string;
  readonly className?: string;
};

type Fit = { readonly count: number; readonly dots: boolean };

function labelledCount(labels: readonly RailLabel[], room: number): number {
  let used = 0;
  let count = 0;
  for (const label of labels) {
    used += WIDTH_REM[label.kind];
    if (used > room) break;
    count += 1;
  }
  return count;
}

function useTicksThatFit(labels: readonly RailLabel[], max: number, total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(() => ({ count: Math.min(max, 6), dots: false }));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const kept = labels.length;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = node.clientWidth / rem;
      const all = labelledCount(labels, width);
      const room = all < kept || total > kept ? width - EARLIER_REM : width;
      const count = labelledCount(labels, room);
      const next: Fit = count >= Math.min(MIN_LABELLED, kept)
        ? { count: Math.max(1, Math.min(max, count)), dots: false }
        : { count: Math.max(1, Math.min(max, Math.floor(room / WIDTH_REM.dot))), dots: true };
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
 * short date over a mark on one line, naming the month only where it changes.
 * Where few labels fit, only the newest keeps its date and the rest are evenly
 * spaced dots. The rail ends at the last tick; how many came before follows on
 * the same line as a quiet note.
 */
export function C14Ribbon({ days, total, max, gold, onOpenDay, newestNote, className = "" }: RibbonProps) {
  const { effectiveLanguage, t } = useLocalization();
  const daysKey = days.slice(0, max).join();
  const labels = useMemo(() => railLabels(daysKey ? daysKey.split(",") : [], effectiveLanguage), [daysKey, effectiveLanguage]);
  const { ref, fit } = useTicksThatFit(labels, max, total);
  const shown = labels.slice(0, onOpenDay ? fit.count : max);
  const dots = Boolean(onOpenDay) && fit.dots;
  const rest = total - shown.length;
  return (
    <div
      ref={ref}
      className={"c14-ribbon " + className}
      data-metal={gold ? "gold" : "silver"}
      data-dots={dots ? "true" : undefined}
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
              style={{ "--c14-tick": WIDTH_REM[kind] + "rem" } as CSSProperties}
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
              {index === 0 && newestNote ? <span className="c14-tick__note">{newestNote}</span> : null}
            </li>
          );
        })}
      </ol>
      {rest > 0 ? <span className="c14-ribbon__earlier" aria-hidden={onOpenDay ? "true" : undefined}>{earlierText(rest, t)}</span> : null}
    </div>
  );
}
