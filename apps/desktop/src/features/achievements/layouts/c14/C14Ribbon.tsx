import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatAchievementDay } from "../../achievementCopy";
import { anyEarlierYear, earlierText, ordinal, shortDay } from "./c14Copy";

/** Widths in rem: a labelled tick, one that also carries a year, a dot-only tick, the "earlier" note after the rail. */
const TICK_REM = 4.5;
const TICK_YEAR_REM = 7;
const DOT_REM = 1.125;
const EARLIER_REM = 5.5;
/** Fewer labelled ticks than this and the rail switches to the newest date followed by dots. */
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
  readonly className?: string;
};

type Fit = { readonly count: number; readonly dots: boolean };

function useTicksThatFit(max: number, tickRem: number, kept: number, total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(() => ({ count: Math.min(max, 6), dots: false }));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = node.clientWidth / rem;
      const labelled = Math.floor(width / tickRem);
      const reserve = labelled < kept || total > kept ? EARLIER_REM : 0;
      const room = width - reserve;
      const count = Math.floor(room / tickRem);
      if (count >= Math.min(MIN_LABELLED, kept)) {
        setFit({ count: Math.max(1, Math.min(max, count)), dots: false });
        return;
      }
      const dots = 1 + Math.floor((room - tickRem) / DOT_REM);
      setFit({ count: Math.max(1, Math.min(max, dots)), dots: true });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [max, tickRem, kept, total]);
  return { ref, fit };
}

/**
 * A row's record as a rail: the latest days newest first as ticks, each a
 * short date over a mark on one line. Where few labels fit, only the
 * newest keeps its date and the rest are dots. The rail ends at the last
 * tick; how many came before follows it as a quiet note.
 */
export function C14Ribbon({ days, total, max, gold, onOpenDay, className = "" }: RibbonProps) {
  const { effectiveLanguage, t } = useLocalization();
  const tickRem = anyEarlierYear(days.slice(0, max)) ? TICK_YEAR_REM : TICK_REM;
  const { ref, fit } = useTicksThatFit(max, tickRem, days.length, total);
  const shown = days.slice(0, onOpenDay ? fit.count : max);
  const dots = Boolean(onOpenDay) && fit.dots;
  const rest = total - shown.length;
  return (
    <div
      ref={ref}
      className={"c14-ribbon " + className}
      data-metal={gold ? "gold" : "silver"}
      data-dots={dots ? "true" : undefined}
      style={{ "--c14-tick": tickRem + "rem" } as CSSProperties}
    >
      <ol className="c14-ribbon__ticks" aria-hidden={onOpenDay ? "true" : undefined}>
        {shown.map((day, index) => {
          const label = dots && index > 0 ? null : <span className="c14-tick__date">{shortDay(day, effectiveLanguage)}</span>;
          return (
            <li key={day} className={label ? "c14-tick" : "c14-tick c14-tick--dot"} data-newest={index === 0 ? "true" : undefined}>
              {onOpenDay ? (
                <button
                  type="button"
                  className="c14-tick__hit"
                  tabIndex={-1}
                  title={ordinal(total - index, t, effectiveLanguage) + " · " + formatAchievementDay(day, effectiveLanguage)}
                  onClick={() => onOpenDay(day)}
                >
                  {label}
                  <span className="c14-tick__mark" />
                </button>
              ) : (
                <span className="c14-tick__hit">
                  {label}
                  <span className="c14-tick__mark" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {rest > 0 ? <span className="c14-ribbon__earlier" aria-hidden={onOpenDay ? "true" : undefined}>{earlierText(rest, t)}</span> : null}
    </div>
  );
}
