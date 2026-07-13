import { useEffect } from "react";

/**
 * Shared Escape-to-close behavior for app modals (modal-chrome dialogs).
 * Pass `disabled` while a submit/delete is in flight so Esc can't interrupt it,
 * or when the modal is closed for components that render dialogs conditionally.
 */
export function useModalDismiss(onDismiss: () => void, options?: { readonly disabled?: boolean }): void {
  const disabled = options?.disabled ?? false;

  useEffect(() => {
    if (disabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, disabled]);
}
