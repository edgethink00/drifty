import { createContext, type RefObject } from "react";

export const ModalPresenceContext = createContext<{
  readonly exiting: boolean;
  readonly root: RefObject<HTMLDivElement>;
} | null>(null);

export const MODAL_MOTION_PANEL_SELECTOR = ".modal-shell, [data-modal-motion-panel]";

// Opening order, rather than DOM order, decides which mounted dialog owns input.
export const modalFocusStack: HTMLElement[] = [];
export function registerModal(root: HTMLElement): () => void {
  // Child effects run before parent effects; a nested dialog must remain on top.
  const childIndex = modalFocusStack.findIndex((entry) => root.contains(entry));
  if (childIndex < 0) modalFocusStack.push(root);
  else modalFocusStack.splice(childIndex, 0, root);
  return () => {
    const index = modalFocusStack.indexOf(root);
    if (index >= 0) modalFocusStack.splice(index, 1);
  };
}

export function ownModalElements(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) =>
    !root.hasAttribute("data-modal-presence") || element.closest("[data-modal-presence]") === root);
}

export function isTopModal(root: HTMLElement): boolean {
  const connected = modalFocusStack.filter((entry) => entry.isConnected);
  return connected[connected.length - 1] === root;
}
