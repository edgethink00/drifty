import { useEffect } from "react";

const MODAL_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(", ");

/**
 * Owns the keyboard-focus lifecycle for a mounted modal dialog without changing
 * its dismissal policy: focus an intentional control, contain Tab navigation,
 * and restore the element that opened the dialog when it unmounts.
 */
export function useModalFocusTrap(
  dialogRef: { readonly current: HTMLElement | null },
  options?: { readonly initialFocusSelector?: string },
): void {
  const initialFocusSelector = options?.initialFocusSelector;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement)
      ? document.activeElement
      : null;

    const focusTimer = window.setTimeout(() => {
      if (!document.contains(dialog)) return;

      const focusableElements = getModalFocusableElements(dialog);
      const requestedInitialFocus = initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      const initialFocus = requestedInitialFocus && focusableElements.includes(requestedInitialFocus)
        ? requestedInitialFocus
        : focusableElements[0] ?? dialog;
      initialFocus.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusableElements = getModalFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const activeElement = document.activeElement;
      const activeIndex = activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (activeIndex <= 0) {
          event.preventDefault();
          lastFocusable.focus({ preventScroll: true });
        }
        return;
      }

      if (activeIndex === -1 || activeIndex === focusableElements.length - 1) {
        event.preventDefault();
        firstFocusable.focus({ preventScroll: true });
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      dialog.removeEventListener("keydown", handleKeyDown);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
  }, [dialogRef, initialFocusSelector]);
}

function getModalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}
