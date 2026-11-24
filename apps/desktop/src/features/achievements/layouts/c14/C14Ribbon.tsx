import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatAchievementDay } from "../../achievementCopy";
import { anyEarlierYear, earlierText, ordinal, tickDay } from "./c14Copy";

/** Widths in rem: a tick, a tick that also carries a year, the "+N" end of the rail. */
const TICK_REM = 3.5;
const TICK_YEAR_REM = 4.75;
const MORE_REM = 3;

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

function useTicksThatFit(max: number, tickRem: number, kept: number, total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(() => Math.min(max, 6));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = node.clientWidth;
      let count = Math.floor(width / (tickRem * rem));
      if (count < kept || total > kept) count = Math.floor((width - MORE_REM * rem) / (tickRem * rem));
      setFit(Math.max(1, Math.min(max, count)));
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
 * short date over a mark on one line, ending in how many came before.
 */
export function C14Ribbon({ days, total, max, gold, onOpenDay, className = "" }: RibbonProps) {
  const { effectiveLanguage, t } = useLocalization();
  const tickRem = anyEarlierYear(days.slice(0, max)) ? TICK_YEAR_REM : TICK_REM;
  const { ref, fit } = useTicksThatFit(max, tickRem, days.length, total);
  const shown = days.slice(0, onOpenDay ? fit : max);
  const rest = total - shown.length;
  return (
    <div
      ref={ref}
      className={"c14-ribbon " + className}
      data-metal={gold ? "gold" : "silver"}
      data-rest={rest > 0 ? "true" : undefined}
      style={{ "--c14-tick": tickRem + "rem" } as CSSProperties}
    >
      <ol className="c14-ribbon__ticks" aria-hidden={onOpenDay ? "true" : undefined}>
        {shown.map((day, index) => {
          const label = tickDay(day, effectiveLanguage);
          return (
            <li key={day} className="c14-tick" data-newest={index === 0 ? "true" : undefined}>
              {onOpenDay ? (
                <button
                  type="button"
                  className="c14-tick__hit"
                  tabIndex={-1}
                  title={ordinal(total - index, t, effectiveLanguage) + " · " + formatAchievementDay(day, effectiveLanguage)}
                  onClick={() => onOpenDay(day)}
                >
                  <span className="c14-tick__date">{label}</span>
                  <span className="c14-tick__mark" />
                </button>
              ) : (
                <span className="c14-tick__hit">
                  <span className="c14-tick__date">{label}</span>
                  <span className="c14-tick__mark" />
                </span>
              )}
            </li>
          );
        })}
        {rest > 0 ? (
          <li className="c14-tick c14-tick--rest" title={earlierText(rest, t)}>
            <span className="c14-tick__date">+{rest}</span>
            <span className="c14-tick__tail" />
          </li>
        ) : null}
      </ol>
    </div>
  );
}
