import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../companion/watcherBridge";

export type PetModeNativeMenuActions = {
  readonly onOpenDashboard: () => void;
  readonly onOpenSettings: () => void;
  readonly onHideForOneHour: () => void;
  readonly onTurnOffPet: () => void;
};

/**
 * Present the operating system's context menu at the current pointer.
 *
 * This mirrors the Companion pill's menu on purpose. The two resident objects
 * answer the same gesture with the same shape, so learning one teaches the
 * other. Keeping it native also matters here for the same reason it does for
 * the pill: the pet is a non-activating, click-through panel, and AppKit owns
 * edge avoidance, focus, dismissal, and the first click far better than a
 * transparent webview approximating them.
 */
export async function openNativePetModeMenu(
  actions: PetModeNativeMenuActions,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const menu = await Menu.new({
    items: [
      {
        id: "pet-open-dashboard",
        text: "Open Dashboard",
        action: actions.onOpenDashboard,
      },
      {
        id: "pet-open-settings",
        text: "Settings…",
        action: actions.onOpenSettings,
      },
      { item: "Separator" },
      {
        id: "pet-hide-one-hour",
        text: "Hide for 1 Hour",
        action: actions.onHideForOneHour,
      },
      {
        id: "pet-turn-off",
        text: "Turn Off Pet",
        action: actions.onTurnOffPet,
      },
    ],
  });

  try {
    await menu.popup(undefined, getCurrentWindow());
    return true;
  } finally {
    await menu.close();
  }
}
