import { useEffect } from "react";
import { isTopModal, modalFocusStack, MODAL_MOTION_PANEL_SELECTOR, ownModalElements, registerModal } from "./modalPresenceContext";

const restoreTargets = new WeakMap<HTMLElement, HTMLElement[]>();

const MODAL_FOCUSABLE_SELECTOR = [
  "button:not([disabled])", "[href]", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(", ");

/** Contain focus until visual removal, then restore the trigger if focus still
 * belongs to this dialog. A ModalPresence boundary owns this for its descendants.
 */
export function useModalFocusTrap(
  dialogRef: { readonly current: HTMLElement | null },
  options?: { readonly initialFocusSelector?: string; readonly enabled?: boolean; readonly explicitTabNavigation?: boolean },
): void {
  const initialFocusSelector = options?.initialFocusSelector;
  const enabled = options?.enabled ?? true;
  const explicitTabNavigation = options?.explicitTabNavigation ?? false;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!enabled || !dialog) return;
    const managed = dialog.hasAttribute("data-modal-presence");
    if (!managed && dialog.closest("[data-modal-presence]")) {
      if (initialFocusSelector) dialog.dataset.modalInitialSelector = initialFocusSelector;
      return () => { delete dialog.dataset.modalInitialSelector; };
    }
    const previousFocus = document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement)
      ? document.activeElement : null;
    const previousOwner = [...modalFocusStack].reverse().find((entry) => previousFocus && entry.contains(previousFocus));
    const returnTargets = [previousFocus, ...(previousOwner ? restoreTargets.get(previousOwner) ?? [] : [])]
      .filter((element): element is HTMLElement => element !== null);
    restoreTargets.set(dialog, returnTargets);
    const unregister = registerModal(dialog);
    let initialized = false;
    const focusInitial = () => {
      if (!document.contains(dialog) || !isTopModal(dialog) || initialized) return;
      const elements = getModalFocusableElements(dialog);
      const declaredSelector = ownModalElements(dialog, "[data-modal-initial-selector]")[0]?.dataset.modalInitialSelector;
      const requested = ownModalElements(dialog, initialFocusSelector ?? declaredSelector ?? "[autofocus], [data-command-search], .modal-x")[0];
      const shell = ownModalElements(dialog, `${MODAL_MOTION_PANEL_SELECTOR}, [role="dialog"]`)[0] ?? (managed ? null : dialog);
      const target = requested && elements.includes(requested) ? requested : elements[0] ?? shell;
      if (!target) return; // Suspense may not have resolved yet.
      if (target === shell && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      initialized = true;
    };
    const timer = window.setTimeout(focusInitial, 0);
    const observer = new MutationObserver(focusInitial);
    observer.observe(dialog, { childList: true, subtree: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(dialog)) return;
      if (dialog.dataset.modalPresence === "exiting") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = getModalFocusableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        const shell = ownModalElements(dialog, MODAL_MOTION_PANEL_SELECTOR)[0] ?? dialog;
        shell.tabIndex = -1;
        shell.focus({ preventScroll: true });
        return;
      }
      const index = elements.indexOf(document.activeElement as HTMLElement);
      // WebKit may skip buttons unless macOS full keyboard access is enabled.
      if (explicitTabNavigation) {
        event.preventDefault();
        const nextIndex = index < 0
          ? event.shiftKey ? elements.length - 1 : 0
          : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
        elements[nextIndex].focus();
        elements[nextIndex].scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return;
      }
      if (event.shiftKey ? index <= 0 : index === -1 || index === elements.length - 1) {
        event.preventDefault();
        const target = elements[event.shiftKey ? elements.length - 1 : 0];
        target.focus();
        target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    };
    // Capture before app-wide shortcuts; an exiting dialog still shields the app.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("keydown", handleKeyDown, true);
      const ownedFocus = dialog.contains(document.activeElement) || document.activeElement === document.body;
      unregister();
      restoreTargets.delete(dialog);
      if (!ownedFocus) return;
      const connected = modalFocusStack.filter((entry) => entry.isConnected);
      const next = connected[connected.length - 1];
      const returnTarget = returnTargets.find((target) => target.isConnected && (!next || next.contains(target)));
      if (returnTarget) {
        returnTarget.focus({ preventScroll: true });
      } else if (next && !next.contains(document.activeElement)) {
        getModalFocusableElements(next)[0]?.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, initialFocusSelector, enabled, explicitTabNavigation]);
}

function getModalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return ownModalElements(dialog, MODAL_FOCUSABLE_SELECTOR)
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true"
      && !element.closest('[inert], [hidden], [aria-hidden="true"]'));
}
