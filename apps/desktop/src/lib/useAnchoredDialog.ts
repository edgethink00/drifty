import { useLayoutEffect, type RefObject } from "react";

/**
 * Centers a dialog once when it opens, then keeps its top edge where it is.
 *
 * Overlays center their dialog on every layout pass, so a dialog that gains a
 * line (a failure message, a revealed field) moves its title up and its actions
 * down by half of the change. Anchoring the top after the first layout leaves
 * everything the user has already read in place; later growth only extends the
 * bottom edge, and the overlay scrolls if that reaches the window edge. The
 * dialog is re-centered when the window is resized.
 */
export function useAnchoredDialog(dialogRef: RefObject<HTMLElement>, options?: { keepWithinOverlay?: boolean }): void {
  const keepWithinOverlay = options?.keepWithinOverlay ?? false;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const overlay = dialog?.parentElement;
    if (!dialog || !overlay) return;
    const anchor = () => {
      const overlayStyle = window.getComputedStyle(overlay);
      const room = overlay.clientHeight
        - (Number.parseFloat(overlayStyle.paddingTop) || 0)
        - (Number.parseFloat(overlayStyle.paddingBottom) || 0)
        - dialog.offsetHeight;
      dialog.style.alignSelf = "start";
      dialog.style.marginTop = `${Math.max(0, Math.floor(room / 2))}px`;
      dialog.style.marginBottom = "0";
    };
    anchor();
    // Some dialogs switch between substantially different content. Preserve
    // the anchor unless growth would put the bottom outside the overlay.
    const observer = keepWithinOverlay && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        const style = window.getComputedStyle(overlay);
        const available = overlay.clientHeight
          - (Number.parseFloat(style.paddingTop) || 0)
          - (Number.parseFloat(style.paddingBottom) || 0)
          - dialog.offsetHeight;
        const current = Number.parseFloat(dialog.style.marginTop) || 0;
        if (current > Math.max(0, available)) {
          dialog.style.marginTop = `${Math.max(0, Math.floor(available))}px`;
        }
      })
      : null;
    observer?.observe(dialog);
    window.addEventListener("resize", anchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", anchor);
    };
  }, [dialogRef, keepWithinOverlay]);
}
