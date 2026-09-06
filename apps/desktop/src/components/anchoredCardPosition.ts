import { clampHoverCoordinate, type FixedHoverPosition } from "./hoverCardPosition";

export const ANCHORED_CARD_GAP = 12;
export const ANCHORED_CARD_VIEWPORT_PADDING = 16;
// While dismissal is pending, pointer travel decides early (see
// trackAnchoredHoverIntent). This window caps a pointer that stalls outside
// the read-only card and absorbs portal event-ordering differences.
export const ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS = 220;
// Travel without getting any closer to the card that dismisses it right away.
// Roughly one or two pointer samples at ordinary speeds, so a move away from
// the card reads as immediate while jitter along an approach path is ignored.
export const ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX = 10;
export const ANCHORED_PREVIEW_CARD_SELECTOR = ".week-activity-inspector--preview";

export type CardAnchorRect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom" | "width" | "height">;

export type AnchoredCardPosition = FixedHoverPosition & {
  readonly side: "left" | "right";
};

export type AnchoredHoverIntent = {
  readonly closestDistance: number;
  readonly closestX: number;
  readonly closestY: number;
};

export type AnchoredHoverIntentStep = {
  readonly intent: AnchoredHoverIntent;
  // approaching: keep waiting (the pointer is inside or closing in).
  // drifting: no progress yet, still within the travel allowance.
  // abandoned: moved on without closing in; dismiss now.
  readonly verdict: "approaching" | "drifting" | "abandoned";
};

export function distanceToCardRect(x: number, y: number, card: CardAnchorRect): number {
  const dx = Math.max(card.left - x, 0, x - card.right);
  const dy = Math.max(card.top - y, 0, y - card.bottom);
  return Math.hypot(dx, dy);
}

// Tracks whether a pointer that left the block is heading for the card. Each
// sample that lands closer than any earlier one resets the travel allowance,
// so an approach with a little jitter keeps the card while a move in any
// other direction gives it up after ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX.
export function trackAnchoredHoverIntent(
  previous: AnchoredHoverIntent | null,
  x: number,
  y: number,
  card: CardAnchorRect,
): AnchoredHoverIntentStep {
  const distance = distanceToCardRect(x, y, card);
  if (!previous || distance === 0 || distance < previous.closestDistance) {
    return { intent: { closestDistance: distance, closestX: x, closestY: y }, verdict: "approaching" };
  }
  const travel = Math.hypot(x - previous.closestX, y - previous.closestY);
  return { intent: previous, verdict: travel > ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX ? "abandoned" : "drifting" };
}

// The rendered preview card, or null while it is absent or not yet laid out.
export function readAnchoredPreviewCardRect(): CardAnchorRect | null {
  if (typeof document === "undefined") return null;
  const card = document.querySelector<HTMLElement>(ANCHORED_PREVIEW_CARD_SELECTOR);
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

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
