import { clampHoverCoordinate, type FixedHoverPosition } from "./hoverCardPosition";

export const ANCHORED_CARD_GAP = 12;
export const ANCHORED_CARD_VIEWPORT_PADDING = 16;
// The transparent gap bridge handles the normal route; this grace window also
// absorbs deliberate diagonal movement and portal event-ordering differences.
export const ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS = 280;

export type CardAnchorRect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom" | "width" | "height">;

export type AnchoredCardPosition = FixedHoverPosition & {
  readonly side: "left" | "right";
};

export function getViewportSafeAnchoredPosition(
  anchor: CardAnchorRect,
  width: number,
  height: number,
): AnchoredCardPosition {
  const fallbackRight = anchor.left + anchor.width;
  const anchorRight = Number.isFinite(anchor.right) ? anchor.right : fallbackRight;
  const preferredRight = anchorRight + ANCHORED_CARD_GAP;

  if (typeof window === "undefined") {
    return { left: preferredRight, top: anchor.top, side: "right" };
  }

  const maxLeft = window.innerWidth - width - ANCHORED_CARD_VIEWPORT_PADDING;
  const maxTop = window.innerHeight - height - ANCHORED_CARD_VIEWPORT_PADDING;
  const flippedLeft = anchor.left - width - ANCHORED_CARD_GAP;
  const rightFits = preferredRight <= maxLeft;
  const leftFits = flippedLeft >= ANCHORED_CARD_VIEWPORT_PADDING;
  const rightSpace = window.innerWidth - anchorRight;
  const leftSpace = anchor.left;
  const side = rightFits || (!leftFits && rightSpace >= leftSpace) ? "right" : "left";
  const preferredLeft = side === "right" ? preferredRight : flippedLeft;

  return {
    left: clampHoverCoordinate(preferredLeft, ANCHORED_CARD_VIEWPORT_PADDING, maxLeft),
    top: clampHoverCoordinate(anchor.top, ANCHORED_CARD_VIEWPORT_PADDING, maxTop),
    side,
  };
}

export function isAnchorOutsideViewport(anchor: CardAnchorRect): boolean {
  if (typeof window === "undefined") return false;
  // JSDOM and a just-mounted element can briefly report an all-zero rectangle.
  // Treat it as unresolved rather than outside so the next layout pass can place it.
  if (anchor.width === 0 && anchor.height === 0) return false;
  return anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth;
}
