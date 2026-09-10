import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Roving focus for a swatch group: arrow keys walk the items, Home/End jump,
 * and only the checked item sits in the tab order (WAI-ARIA radiogroup).
 * Attach to the group's onKeyDown; items are its `[role="radio"]` buttons.
 */
export function moveRovingFocus(event: ReactKeyboardEvent<HTMLElement>, columns: number): void {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='radio']"));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || items.length === 0) return;
  let next = index;
  switch (event.key) {
    case "ArrowRight": next = (index + 1) % items.length; break;
    case "ArrowLeft": next = (index - 1 + items.length) % items.length; break;
    case "ArrowDown": next = Math.min(index + columns, items.length - 1); break;
    case "ArrowUp": next = Math.max(index - columns, 0); break;
    case "Home": next = 0; break;
    case "End": next = items.length - 1; break;
    default: return;
  }
  event.preventDefault();
  items[next]?.focus();
}
