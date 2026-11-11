import { useEffect, useRef, type RefObject } from "react";

type DismissOptions = {
  /** Where focus goes when Escape dismisses, usually the trigger. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
  /** Pass false when the popup's own key handler already closes on Escape. */
  readonly escape?: boolean;
  /**
   * Keep Escape from also reaching a page shortcut listening on the window.
   * The key is then handled on the document, before it reaches the window.
   */
  readonly containEscape?: boolean;
};

/**
 * Closes a menu or popover when the user presses outside it or presses Escape.
 *
 * `inside` names every element a press may land on without closing: the popup
 * and its trigger. The trigger belongs there so that its own click decides what
 * a second press does. If the press closed the popup here first, that click
 * would find it closed and open it again.
 */
export function useDismissOnOutsidePress(
  open: boolean,
  onDismiss: () => void,
  inside: readonly RefObject<Element | null>[],
  options: DismissOptions = {},
): void {
  const latest = useRef({ onDismiss, inside, options });
  latest.current = { onDismiss, inside, options };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && latest.current.inside.some((ref) => ref.current?.contains(target))) return;
      latest.current.onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { options: current, onDismiss: dismiss } = latest.current;
      if (event.key !== "Escape" || current.escape === false) return;
      if (current.containEscape) {
        event.preventDefault();
        event.stopPropagation();
      }
      dismiss();
      current.returnFocusTo?.current?.focus({ preventScroll: true });
    };
    // Escape is read on the window, the last stop of a key press, so a popup or
    // field that handles the key itself gets it first.
    const keyTarget: Document | Window = latest.current.options.containEscape ? document : window;
    document.addEventListener("pointerdown", onPointerDown);
    keyTarget.addEventListener("keydown", onKeyDown as EventListener);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      keyTarget.removeEventListener("keydown", onKeyDown as EventListener);
    };
  }, [open]);
}
