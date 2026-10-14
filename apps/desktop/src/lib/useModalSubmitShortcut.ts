import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export type ModalSubmitShortcut = "enter" | "modEnter";

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';
const SINGLE_LINE_INPUT_TYPES = new Set(["text", "email", "url", "search", "password", "tel", "number"]);

function isSingleLineTextField(element: Element): boolean {
  return element instanceof HTMLInputElement && SINGLE_LINE_INPUT_TYPES.has(element.type);
}

/**
 * Keyboard submit for a dialog's primary action or its active form. Dialog
 * actions pair this with KeyHint; auth forms intentionally omit the chip.
 *
 * - `enter`: Enter in a single-line text field submits.
 * - `modEnter`: ⌘/Ctrl+Enter submits from anywhere in the dialog, and Enter in
 *   a single-line field submits too. Enter in a textarea stays a newline.
 *
 * A focused button keeps plain Enter for itself (the web and Windows
 * convention), Enter that commits IME composition (Hangul) never submits, and
 * a key already handled by an inner control or owned by a nested dialog is left
 * alone. Inside a `<form>`, plain Enter is left to the browser's implicit
 * submission so the form's own submit handler runs once; pass an `onSubmit`
 * that calls `form.requestSubmit()` for the ⌘/Ctrl+Enter path.
 *
 * Pass `disabled` whenever the primary button is disabled, so the key never
 * does something the button cannot.
 */
export function useModalSubmitShortcut(
  dialogRef: RefObject<HTMLElement | null>,
  shortcut: ModalSubmitShortcut,
  onSubmit: () => void,
  options?: { readonly disabled?: boolean },
): void {
  const submitRef = useRef(onSubmit);
  useLayoutEffect(() => {
    submitRef.current = onSubmit;
  });
  const disabled = options?.disabled ?? false;

  useEffect(() => {
    if (disabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.altKey || event.shiftKey) return;
      // WebKit reports the Enter that commits a Hangul syllable as keyCode 229.
      if (event.isComposing || event.keyCode === 229) return;
      const dialog = dialogRef.current;
      const target = event.target;
      if (!dialog || !(target instanceof Element) || !dialog.contains(target)) return;
      if (target.closest(DIALOG_SELECTOR) !== dialog.closest(DIALOG_SELECTOR)) return;
      if (event.metaKey || event.ctrlKey) {
        if (shortcut !== "modEnter") return;
      } else if (!isSingleLineTextField(target) || target.closest("form")) {
        return;
      }
      event.preventDefault();
      submitRef.current();
    };
    // Bubble phase on window: inner handlers (and React's) have already run.
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogRef, shortcut, disabled]);
}
