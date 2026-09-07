import { useContext, useEffect } from "react";

import { ModalPresenceContext, isTopModal } from "./modalPresenceContext";

/**
 * Shared Escape-to-close behavior for app modals (modal-chrome dialogs).
 * Pass `disabled` while a submit/delete is in flight so Esc can't interrupt it,
 * or when the modal is closed for components that render dialogs conditionally.
 */
export function useModalDismiss(onDismiss: () => void, options?: { readonly disabled?: boolean }): void {
  const presence = useContext(ModalPresenceContext);
  const disabled = options?.disabled ?? false;

  useEffect(() => {
    if (disabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (presence && (presence.exiting || !presence.root.current || !isTopModal(presence.root.current))) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, disabled, presence]);
}
