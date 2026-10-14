import { useLayoutEffect, useRef } from "react";
import type { HostPlatform } from "../lib/api/accessibilityClient";

/**
 * A key a dialog action answers to. Each hint must sit on the button its key
 * actually presses, so a visible hint is never a promise the dialog breaks:
 *
 * - `escape`: the button that does exactly what the dialog's Escape does
 *   (`useModalDismiss` or a `ModalPresence` `onDismiss`).
 * - `enter`: a form's submit action. Enter in a single-line field presses it,
 *   through `useModalSubmitShortcut` or the browser's own form submission.
 * - `modEnter`: a dialog's explicit primary action, including multi-line form
 *   submission and history-range deletion. ⌘/Ctrl+Enter presses it unless an
 *   inner control owns the key (`useModalSubmitShortcut`).
 *
 * Payment, consent and other plain delete confirmations take no submit shortcut.
 * History-range deletion uses the explicit modifier shortcut only.
 * `modalSystemContract.test.ts` checks the pairing (product decision
 * 2026-10-13 "Dialog key hints").
 */
export type KeyHintShortcut = "escape" | "enter" | "modEnter";

type KeyFamily = "mac" | "pc";

const LABELS: Record<KeyFamily, Record<KeyHintShortcut, string>> = {
  mac: { escape: "Esc", enter: "↵", modEnter: "⌘↵" },
  pc: { escape: "Esc", enter: "Enter", modEnter: "Ctrl+Enter" },
};

const ARIA_KEYS: Record<KeyFamily, Record<KeyHintShortcut, string>> = {
  mac: { escape: "Escape", enter: "Enter", modEnter: "Meta+Enter" },
  pc: { escape: "Escape", enter: "Enter", modEnter: "Control+Enter" },
};

function keyFamily(platform: HostPlatform): KeyFamily {
  return platform === "macos" ? "mac" : "pc";
}

/** The platform the shell already styles for: index.html seeds the root
 * `data-platform` before the first paint and App keeps it on the confirmed
 * host platform, so hints switch together with the Windows chrome. */
function appliedHostPlatform(): HostPlatform {
  const applied = typeof document === "undefined" ? undefined : document.documentElement.dataset.platform;
  return applied === "windows" || applied === "other" ? applied : "macos";
}

export function keyHintLabel(shortcut: KeyHintShortcut, platform: HostPlatform): string {
  return LABELS[keyFamily(platform)][shortcut];
}

/**
 * The chip itself is hidden from assistive technology so the button keeps its
 * plain label as its accessible name; the key is announced through the
 * button's `aria-keyshortcuts` instead.
 */
export function KeyHint({ shortcut }: { readonly shortcut: KeyHintShortcut }): JSX.Element {
  const family = keyFamily(appliedHostPlatform());
  const chipRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const button = chipRef.current?.closest("button");
    if (!button) return undefined;
    button.setAttribute("aria-keyshortcuts", ARIA_KEYS[family][shortcut]);
    return () => button.removeAttribute("aria-keyshortcuts");
  }, [family, shortcut]);

  return (
    <kbd ref={chipRef} className="key-hint" aria-hidden="true">
      {LABELS[family][shortcut]}
    </kbd>
  );
}
