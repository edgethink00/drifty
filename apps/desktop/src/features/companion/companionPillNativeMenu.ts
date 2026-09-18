import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./watcherBridge";

export type CompanionPillNativeMenuActions = {
  readonly onOpenDashboard: () => void;
  readonly onOpenSettings: () => void;
  readonly onHideForOneHour: () => void;
  readonly onTurnOffCompanion: () => void;
};

export type CompanionPillNativeMenuLabels = {
  readonly openDashboard: string;
  readonly settings: string;
  readonly hideForOneHour: string;
  readonly turnOffCompanion: string;
};

const ENGLISH_MENU_LABELS: CompanionPillNativeMenuLabels = {
  openDashboard: "Open Dashboard",
  settings: "Settings…",
  hideForOneHour: "Hide for 1 Hour",
  turnOffCompanion: "Turn Off Companion",
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
  labels: CompanionPillNativeMenuLabels = ENGLISH_MENU_LABELS,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const menu = await Menu.new({
    items: [
      {
        id: "companion-open-dashboard",
        text: labels.openDashboard,
        action: actions.onOpenDashboard,
      },
      {
        id: "companion-open-settings",
        text: labels.settings,
        action: actions.onOpenSettings,
      },
      { item: "Separator" },
      {
        id: "companion-hide-one-hour",
        text: labels.hideForOneHour,
        action: actions.onHideForOneHour,
      },
      {
        id: "companion-turn-off",
        text: labels.turnOffCompanion,
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
