import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** The height tween a card runs as it opens into its form or folds back. */
const HEIGHT_TWEEN = { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" } as const;

const TWEEN_ID = "category-editor-card-height";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Moves the list when a card opens into its form or folds back, as an
 * accordion: every card whose height changed glides from its last height to
 * the new one, so the rows below follow instead of jumping, and folding
 * animates too. Once the open card has its full height it scrolls into view
 * only if it is cut off. With reduced motion the swap is instant.
 */
export function useCardMotion(rootRef: RefObject<HTMLElement | null>, openKey: string | null): void {
  const heights = useRef(new Map<string, number>());
  const lastKey = useRef<string | null>(openKey);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const keyChanged = lastKey.current !== openKey;
    lastKey.current = openKey;
    const animate = !prefersReducedMotion();
    const next = new Map<string, number>();
    for (const card of Array.from(root.querySelectorAll<HTMLElement>(".category-editor__card[data-card]"))) {
      const id = card.dataset.card ?? "";
      const running = typeof card.getAnimations === "function" ? card.getAnimations().filter((animation) => animation.id === TWEEN_ID) : [];
      if (!keyChanged) {
        // Mid-tween the box is between heights; keep the height it is heading to.
        next.set(id, running.length > 0 ? heights.current.get(id) ?? card.offsetHeight : card.offsetHeight);
        continue;
      }
      const from = running.length > 0 ? card.getBoundingClientRect().height : heights.current.get(id);
      for (const animation of running) animation.cancel();
      const to = card.offsetHeight;
      next.set(id, to);
      if (!animate || from === undefined || Math.abs(from - to) < 1 || typeof card.animate !== "function") continue;
      card.classList.add("is-tweening");
      const animation = card.animate([{ height: from + "px" }, { height: to + "px" }], HEIGHT_TWEEN);
      animation.id = TWEEN_ID;
      const settle = () => { if (!card.getAnimations().some((other) => other.id === TWEEN_ID && other !== animation)) card.classList.remove("is-tweening"); };
      animation.addEventListener("finish", settle);
      animation.addEventListener("cancel", settle);
    }
    heights.current = next;
  });

  useEffect(() => {
    if (openKey === null) return undefined;
    const reveal = (options: ScrollIntoViewOptions) => rootRef.current?.querySelector<HTMLElement>(".category-editor__card.is-editing")?.scrollIntoView?.(options);
    if (prefersReducedMotion()) {
      reveal({ block: "nearest" });
      return undefined;
    }
    const timer = window.setTimeout(() => reveal({ block: "nearest", behavior: "smooth" }), HEIGHT_TWEEN.duration);
    return () => window.clearTimeout(timer);
  }, [openKey, rootRef]);
}
