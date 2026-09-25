import { useEffect, useState, type RefObject } from "react";

export type ScrollOverflowEdges = "none" | "top" | "bottom" | "both";

// Larger than the scroll area's 4px ring-room padding and sub-pixel layout,
// so a list that is fully in view never shows a phantom fade.
const EDGE_TOLERANCE_PX = 8;

/**
 * Reports which edges of a scroll container hide content. The fixed-size
 * onboarding window cannot be resized and macOS hides scrollbars by default,
 * so a fade on the hidden edge is the only cue that more content exists.
 */
export function useScrollOverflowEdges(
  scrollRef: RefObject<HTMLElement | null>,
  contentKey: unknown,
): ScrollOverflowEdges {
  const [edges, setEdges] = useState<ScrollOverflowEdges>("none");

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const hiddenAbove = element.scrollTop > EDGE_TOLERANCE_PX;
      const hiddenBelow = element.scrollHeight - element.clientHeight - element.scrollTop > EDGE_TOLERANCE_PX;
      setEdges(hiddenAbove && hiddenBelow ? "both" : hiddenAbove ? "top" : hiddenBelow ? "bottom" : "none");
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    for (const child of Array.from(element.children)) resizeObserver?.observe(child);
    return () => {
      element.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
    };
  }, [contentKey, scrollRef]);

  return edges;
}
