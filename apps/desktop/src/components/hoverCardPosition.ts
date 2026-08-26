export type FixedHoverPosition = {
  left: number;
  top: number;
};

export const HOVER_CARD_OFFSET = 16;

export const HOVER_CARD_VIEWPORT_PADDING = 16;

export function clampHoverCoordinate(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function getViewportSafeHoverPosition(anchorX: number, anchorY: number, width: number, height: number): FixedHoverPosition {
  if (typeof window === "undefined") {
    return { left: anchorX + HOVER_CARD_OFFSET, top: anchorY + HOVER_CARD_OFFSET };
  }

  const { innerWidth, innerHeight } = window;
  const maxLeft = innerWidth - width - HOVER_CARD_VIEWPORT_PADDING;
  const maxTop = innerHeight - height - HOVER_CARD_VIEWPORT_PADDING;
  const preferredLeft = anchorX + HOVER_CARD_OFFSET;
  const preferredTop = anchorY + HOVER_CARD_OFFSET;
  const flippedLeft = anchorX - width - HOVER_CARD_OFFSET;
  const flippedTop = anchorY - height - HOVER_CARD_OFFSET;
  const left = preferredLeft > maxLeft && flippedLeft >= HOVER_CARD_VIEWPORT_PADDING ? flippedLeft : preferredLeft;
  const top = preferredTop > maxTop && flippedTop >= HOVER_CARD_VIEWPORT_PADDING ? flippedTop : preferredTop;

  return {
    left: clampHoverCoordinate(left, HOVER_CARD_VIEWPORT_PADDING, maxLeft),
    top: clampHoverCoordinate(top, HOVER_CARD_VIEWPORT_PADDING, maxTop),
  };
}
