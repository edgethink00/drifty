import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type FlowChartScrollScale = {
  readonly zoomPercent: number;
  readonly dayKey: string;
  /** Logical minute of the first activity (or now). Null waits for data. */
  readonly initialMinute: number | null;
  /** Optional review anchor, preserving the viewed hour across scale changes. */
  readonly initialScrollMinute?: number | null;
  /** Persist only reader-driven changes, not clamping during zoom. */
  readonly onReadMinuteChange?: (minute: number) => void;
  /** An explicit Now action, distinct from revisiting today's reading position. */
  readonly positionRequest?: number;
};

/** One scroll owner for the time rail, cells and time-aligned card overlay. */
export function FlowChartScrollArea({ scale, label, children }: {
  readonly scale: FlowChartScrollScale;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fitHeight, setFitHeight] = useState(0);
  const positionedDay = useRef<string | null>(null);
  const previousHourHeight = useRef(0);
  const viewedMinute = useRef<number | null>(null);
  const expectedScrollTop = useRef<number | null>(null);
  const positionedRequest = useRef(scale.positionRequest ?? 0);
  const onReadMinuteChange = useRef(scale.onReadMinuteChange);
  onReadMinuteChange.current = scale.onReadMinuteChange;
  const hourHeight = fitHeight / 24 * scale.zoomPercent / 100;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      // The minute band is a sibling, so this box is exactly the plot viewport.
      // The onboarding picture scales its window. Measure layout pixels so
      // that transform does not apply a second time to the hour spacing.
      const available = element.clientHeight || element.getBoundingClientRect().height;
      // Match the existing fit view: 24 rows, 18px floor and 56px ceiling.
      if (available > 0) setFitHeight(Math.max(18 * 24, Math.min(56 * 24, available)));
    };
    measure();
    // Without ResizeObserver the first measure stands, as in the card lane.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || hourHeight <= 0) return;
    const requestedPosition = scale.positionRequest !== undefined && positionedRequest.current !== scale.positionRequest;
    if (positionedDay.current === scale.dayKey && !requestedPosition) {
      if (previousHourHeight.current > 0 && previousHourHeight.current !== hourHeight) {
        // The browser may already have clamped scrollTop to the shorter new
        // content. Use the last read minute, recorded before that clamp.
        element.scrollTop = (viewedMinute.current ?? element.scrollTop / previousHourHeight.current * 60) / 60 * hourHeight;
        expectedScrollTop.current = element.scrollTop;
      }
      previousHourHeight.current = hourHeight;
      return;
    }
    if (scale.initialMinute === null && scale.initialScrollMinute == null) return;
    // Position once per date, leaving a little context before the first run.
    // Subsequent activity/tick updates must never pull a reader away.
    viewedMinute.current = (requestedPosition ? null : scale.initialScrollMinute)
      ?? Math.max(0, (scale.initialMinute ?? 0) - 30 - 8 / hourHeight * 60);
    element.scrollTop = viewedMinute.current / 60 * hourHeight;
    expectedScrollTop.current = element.scrollTop;
    // Now is an explicit reading choice too. Remember its actual, possibly
    // clamped position so a later revisit does not resurrect the pre-Now hour.
    if (requestedPosition) onReadMinuteChange.current?.(element.scrollTop / hourHeight * 60);
    positionedDay.current = scale.dayKey;
    if (scale.positionRequest !== undefined) positionedRequest.current = scale.positionRequest;
    previousHourHeight.current = hourHeight;
  }, [scale.dayKey, hourHeight, scale.initialMinute, scale.initialScrollMinute, scale.positionRequest]);
  const style = { "--flow-scroll-hour-height": `${hourHeight}px` } as CSSProperties;
  return <div ref={ref} className="flow-chart-scroll-area" style={style} role="region" aria-label={label} tabIndex={0} onScroll={event => {
    const top = event.currentTarget.scrollTop;
    if (expectedScrollTop.current !== null && Math.abs(top - expectedScrollTop.current) < 1) return;
    expectedScrollTop.current = null;
    if (hourHeight > 0) {
      viewedMinute.current = top / hourHeight * 60;
      positionedDay.current = scale.dayKey;
      previousHourHeight.current = hourHeight;
      scale.onReadMinuteChange?.(viewedMinute.current);
    }
  }}>
    {children}
  </div>;
}
