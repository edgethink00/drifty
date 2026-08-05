import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./watcherBridge";

export type CompanionPillNativeMenuActions = {
  readonly onOpenDashboard: () => void;
  readonly onOpenSettings: () => void;
  readonly onHideForOneHour: () => void;
  readonly onTurnOffCompanion: () => void;
};

/**
 * Present the operating system's context menu at the current pointer.
 *
 * Keeping this native matters for a non-activating floating panel: AppKit owns
 * edge avoidance, focus, dismissal, and the first click instead of asking a
 * larger transparent webview to approximate those behaviours.
 */
export async function openNativeCompanionPillMenu(
  actions: CompanionPillNativeMenuActions,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const menu = await Menu.new({
    items: [
      {
        id: "companion-open-dashboard",
        text: "Open Dashboard",
        action: actions.onOpenDashboard,
      },
      {
        id: "companion-open-settings",
        text: "Settings…",
        action: actions.onOpenSettings,
      },
      { item: "Separator" },
      {
        id: "companion-hide-one-hour",
        text: "Hide for 1 Hour",
        action: actions.onHideForOneHour,
      },
      {
        id: "companion-turn-off",
        text: "Turn Off Companion",
        action: actions.onTurnOffCompanion,
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
