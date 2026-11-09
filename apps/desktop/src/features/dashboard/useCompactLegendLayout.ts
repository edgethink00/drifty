import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type CompactLegendLayout = "inline" | "stacked";

/* A row fits on one line when its swatch, whole name and value fit the legend
   width. Every width read here is the same in both layouts, so switching the
   layout never changes the answer. */
function legendNeedsStacking(legend: HTMLElement): boolean {
  const available = legend.clientWidth;
  if (available <= 0) return false;
  return Array.from(legend.children).some((row) => {
    const [swatch, label, value] = Array.from(row.children) as HTMLElement[];
    if (!swatch || !label || !value) return false;
    const columnGap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    return swatch.offsetWidth + label.scrollWidth + value.scrollWidth + columnGap * 2 > available;
  });
}

/* Keep each name and its value on one line, and put the values under every
   name only when a (usually translated) name would otherwise be cut off. */
export function useCompactLegendLayout(contentKey: string): {
  readonly legendRef: RefObject<HTMLDivElement>;
  readonly legendLayout: CompactLegendLayout;
} {
  const legendRef = useRef<HTMLDivElement>(null);
  const [legendLayout, setLegendLayout] = useState<CompactLegendLayout>("inline");
  useLayoutEffect(() => {
    const legend = legendRef.current;
    if (!legend) return undefined;
    let active = true;
    const measure = () => {
      if (!active) return;
      const next: CompactLegendLayout = legendNeedsStacking(legend) ? "stacked" : "inline";
      setLegendLayout((current) => (current === next ? current : next));
    };
    measure();
    void document.fonts?.ready.then(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(legend);
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [contentKey]);
  return { legendRef, legendLayout };
}
