import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useRef } from "react";
import { isTauriRuntime } from "../companion/watcherBridge";

export const PET_MODE_BROWSER_X_SHORTCUT = "Control+Alt+X";
export const PET_MODE_BROWSER_X_SHORTCUT_LABEL = "⌃⌥X";
export const PET_MODE_BROWSER_X_SHORTCUT_COOLDOWN_MS = 2_000;

type UsePetModeBrowserXShortcutOptions = {
  readonly enabled: boolean;
  readonly onTrigger: () => void;
  readonly onRegistrationError: () => void;
};

export function canTriggerPetModeBrowserXShortcut(
  busy: boolean,
  lastTriggeredAt: number,
  now: number,
): boolean {
  return !busy && now - lastTriggeredAt >= PET_MODE_BROWSER_X_SHORTCUT_COOLDOWN_MS;
}

/**
 * Registers the destructive Lab shortcut only for the lifetime of an explicit
 * Dev-session opt-in. The handler reference stays fresh without repeatedly
 * unregistering while activity segments update in the background.
 */
export function usePetModeBrowserXShortcut({
  enabled,
  onTrigger,
  onRegistrationError,
}: UsePetModeBrowserXShortcutOptions): void {
  const triggerRef = useRef(onTrigger);
  const registrationErrorRef = useRef(onRegistrationError);

  useEffect(() => {
    triggerRef.current = onTrigger;
  }, [onTrigger]);

  useEffect(() => {
    registrationErrorRef.current = onRegistrationError;
  }, [onRegistrationError]);

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return undefined;

    let disposed = false;
    let registered = false;
    const handleShortcut = (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      triggerRef.current();
    };

    void (async () => {
      // HMR or a previously interrupted Dev session can leave this exact key
      // registered. Remove only our fixed shortcut before claiming it again.
      await unregister(PET_MODE_BROWSER_X_SHORTCUT).catch(() => undefined);
      if (disposed) return;
      await register(PET_MODE_BROWSER_X_SHORTCUT, handleShortcut);
      registered = true;
      if (disposed) {
        registered = false;
        await unregister(PET_MODE_BROWSER_X_SHORTCUT).catch(() => undefined);
      }
    })().catch(() => {
      if (!disposed) registrationErrorRef.current();
    });

    return () => {
      disposed = true;
      if (registered) void unregister(PET_MODE_BROWSER_X_SHORTCUT).catch(() => undefined);
    };
  }, [enabled]);
}
