import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type CompactLegendLayout = "inline" | "stacked";

/* The width an element's own text needs, whatever width its box was given.
   In the stacked layout a name's box stretches across the row, and
   scrollWidth is never less than the box, so reading scrollWidth there said a
   short name was as wide as the row and the legend never came back to one
   line once it had stacked (as it does while the Breakdown is opening). */
function textWidth(element: HTMLElement): number {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const width = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect().width : 0;
  return width > 0 ? Math.ceil(width) : element.scrollWidth;
}

/* A row fits on one line when its swatch, whole name and value fit the legend
   width. Every width read here is the same in both layouts, so switching the
   layout never changes the answer. */
export function legendNeedsStacking(legend: HTMLElement): boolean {
  const available = legend.clientWidth;
  if (available <= 0) return false;
  return Array.from(legend.children).some((row) => {
    const [swatch, label, value] = Array.from(row.children) as HTMLElement[];
    if (!swatch || !label || !value) return false;
    const columnGap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    return swatch.offsetWidth + textWidth(label) + textWidth(value) + columnGap * 2 > available;
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
