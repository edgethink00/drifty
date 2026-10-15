import { useLayoutEffect, type RefObject } from "react";

/** Move the space saved by Day's compact trend chrome and gap into its flow plot.
 * Measure the existing layout before applying the compact chrome: summing a
 * per-row CSS increment loses fractional pixels when the browser rounds rows.
 * Both measurements happen together before paint; no duplicate chart is needed.
 */
export function useDayChartHeightTransfer(
  mainRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!enabled || !main) return;

    let plot: HTMLElement | null = null;
    let stopped = false;
    const update = () => {
      if (stopped) return;
      plot = main.querySelector<HTMLElement>(".flow-chart-grid");
      const flow = main.querySelector<HTMLElement>(".flow-breakdown-layout");
      const trend = main.querySelector<HTMLElement>(".dashboard-insight-stack > .insight-chart-panel");
      if (!plot || !flow || !trend) return;

      main.removeAttribute("data-day-chart-density");
      plot.style.removeProperty("height");
      const originalPlotHeight = plot.getBoundingClientRect().height;
      const originalTrendHeight = trend.getBoundingClientRect().height;
      const originalGap = Number.parseFloat(getComputedStyle(flow).marginBottom) || 0;

      main.dataset.dayChartDensity = "compact";
      const compactGap = Number.parseFloat(getComputedStyle(flow).marginBottom) || 0;
      const savedHeight = originalTrendHeight - trend.getBoundingClientRect().height
        + originalGap - compactGap;
      plot.style.height = `${originalPlotHeight + savedHeight}px`;
    };

    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    // Main catches width/content changes, while the trend catches font or
    // legend wrapping changes even when the conserved main height stays equal.
    observer?.observe(main);
    const trend = main.querySelector(".dashboard-insight-stack");
    if (trend) observer?.observe(trend);
    window.addEventListener("resize", update);
    document.fonts?.addEventListener("loadingdone", update);

    return () => {
      stopped = true;
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.fonts?.removeEventListener("loadingdone", update);
      main.removeAttribute("data-day-chart-density");
      plot?.style.removeProperty("height");
    };
  }, [enabled, mainRef]);
}
