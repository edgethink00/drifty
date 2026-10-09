import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

type OverlayDismissOptions = {
  /** Ignore outside clicks entirely, for example while a request is in flight. */
  readonly disabled?: boolean;
  /**
   * The dialog holds input the user has not saved. An outside click leaves it
   * open and nudges the panel instead; Escape, Cancel and the close button
   * still dismiss it, because those are deliberate.
   */
  readonly keepOpen?: boolean;
};

export type OverlayDismissProps = {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
};

const NUDGE_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.012)" },
  { transform: "scale(1)" },
];

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Props for a modal overlay that closes its dialog on an outside click.
 *
 * A click whose press began inside the dialog never counts. Selecting text in
 * a field and releasing past the dialog edge produces a click whose target is
 * the overlay (the nearest common ancestor of press and release); that used to
 * close the dialog and drop whatever had been typed.
 */
export function useOverlayDismiss(onDismiss: () => void, options: OverlayDismissOptions = {}): OverlayDismissProps {
  const { disabled = false, keepOpen = false } = options;
  const pressStartedInside = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    pressStartedInside.current = event.target !== event.currentTarget;
  }, []);

  const onClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const startedInside = pressStartedInside.current;
    pressStartedInside.current = false;
    if (event.target !== event.currentTarget || startedInside || disabled) return;
    if (keepOpen) {
      const panel = event.currentTarget.firstElementChild;
      if (panel instanceof HTMLElement && typeof panel.animate === "function" && !prefersReducedMotion()) {
        panel.animate(NUDGE_KEYFRAMES, { duration: 220, easing: "ease-out" });
      }
      return;
    }
    onDismiss();
  }, [disabled, keepOpen, onDismiss]);

  return { onPointerDown, onClick };
}

