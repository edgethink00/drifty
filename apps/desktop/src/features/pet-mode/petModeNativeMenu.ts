import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../companion/watcherBridge";
import { resolveInitialDisplayLanguage } from "../localization/languagePreference";
import type { PetPresenceMode } from "./petPresenceMode";
import type {
  PetQuickControlsAction,
  PetQuickControlsAutomaticCloseOverridePayload,
} from "./petModeBridge";

export type PetModeNativeMenuActions = {
  readonly onOpenDashboard: () => void;
  readonly onOpenSettings: () => void;
  readonly onHideForOneHour: () => void;
  readonly onPresenceModeChange: (mode: PetPresenceMode) => void;
  readonly onTurnOffPet: () => void;
};

export type PetModeNativeMenuState = {
  readonly language?: "en" | "ko";
  readonly presenceMode?: PetPresenceMode;
};

export type PetModeAutomaticCloseMenuState = {
  readonly savedEnabled: boolean;
  readonly override: PetQuickControlsAutomaticCloseOverridePayload | null;
  readonly language?: "en" | "ko";
};

function petModeMenuCopy(language: "en" | "ko") {
  if (language === "ko") {
    return {
      openDashboard: "Drifty 열기",
      openSettings: "펫 설정…",
      automaticCloseSettings: "자동 닫기 설정…",
      hideOneHour: "펫 1시간 숨기기",
      showOnlyOnDrift: "딴짓할 때만 나타나기",
      stayAlways: "항상 함께 있기",
      turnOffPet: "펫 끄기",
      turnOffSuggestionHeader: "펫을 완전히 끌까요?",
      turnOffSuggestionDriftOnly: "딴짓할 때만 나타나기",
      turnOffSuggestionConfirm: "완전히 끄기",
    };
  }
  return {
    openDashboard: "Open Drifty",
    openSettings: "Pet Settings…",
    automaticCloseSettings: "Auto-close Settings…",
    hideOneHour: "Hide Pet for 1 Hour",
    showOnlyOnDrift: "Show Only When Drifting",
    stayAlways: "Stay On Screen",
    turnOffPet: "Turn Off Pet",
    turnOffSuggestionHeader: "Turn the pet off completely?",
    turnOffSuggestionDriftOnly: "Show Only When Drifting",
    turnOffSuggestionConfirm: "Turn Off",
  };
}

function automaticCloseMenuCopy(language: "en" | "ko") {
  if (language === "ko") {
    return {
      pause15: "15분 멈추기",
      pause60: "1시간 멈추기",
      pauseToday: "자정까지 멈추기",
      pauseForever: "계속 멈추기",
      pauseHeader: "자동 닫기 멈추기",
      turnOn: "자동 닫기 켜기",
      restoreOn: "지금 다시 켜기",
      restoreOff: "지금 다시 끄기",
      returnsOn: "시간이 끝나면 자동으로 다시 켜집니다.",
    };
  }
  return {
    pause15: "Pause for 15 Minutes",
    pause60: "Pause for 1 Hour",
    pauseToday: "Pause Until Midnight",
    pauseForever: "Pause Until Resumed",
    pauseHeader: "Pause Auto-close",
    turnOn: "Turn On Auto-close",
    restoreOn: "Turn Back On Now",
    restoreOff: "Turn Back Off Now",
    returnsOn: "Auto-close turns back on when the time ends.",
  };
}

export async function openNativeAutomaticCloseMenu(
  onAction: (action: PetQuickControlsAction) => void,
  state: PetModeAutomaticCloseMenuState,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const copy = automaticCloseMenuCopy(state.language ?? resolveInitialDisplayLanguage());
  const items: NonNullable<MenuOptions["items"]> = [];
  const item = (id: string, text: string, action: PetQuickControlsAction) => ({
    id,
    text,
    action: () => onAction(action),
  });
  const override = state.override;

  if (!override) {
    if (state.savedEnabled) {
      items.push(
        { id: "pet-auto-close-pause-header", text: copy.pauseHeader, enabled: false },
        item("pet-auto-close-pause-15", copy.pause15, "automaticClosePause15"),
        item("pet-auto-close-pause-60", copy.pause60, "automaticClosePause60"),
        item("pet-auto-close-pause-today", copy.pauseToday, "automaticClosePauseToday"),
        item("pet-auto-close-pause-forever", copy.pauseForever, "automaticClosePauseForever"),
      );
    } else {
      items.push(item("pet-auto-close-turn-on", copy.turnOn, "toggleAutomaticClose"));
    }
  } else {
    items.push(item(
      "pet-auto-close-restore",
      override.enabled ? copy.restoreOff : copy.restoreOn,
      "automaticCloseRestore",
    ));
  }

  if (!override && state.savedEnabled) {
    items.push(
      { item: "Separator" },
      { id: "pet-auto-close-foot", text: copy.returnsOn, enabled: false },
    );
  }

  const menu = await Menu.new({ items });
  try {
    await menu.popup(undefined, getCurrentWindow());
    return true;
  } finally {
    await menu.close();
  }
}

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
  state: PetModeNativeMenuState = {},
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const copy = petModeMenuCopy(state.language ?? resolveInitialDisplayLanguage());
  const presenceMode = state.presenceMode ?? "always";
  const menu = await Menu.new({
    items: [
      {
        id: "pet-open-dashboard",
        text: copy.openDashboard,
        action: actions.onOpenDashboard,
      },
      {
        id: "pet-open-settings",
        text: copy.openSettings,
        action: actions.onOpenSettings,
      },
      { item: "Separator" },
      {
        id: "pet-automatic-close-settings",
        text: copy.automaticCloseSettings,
        action: actions.onOpenSettings,
      },
      {
        id: "pet-hide-one-hour",
        text: copy.hideOneHour,
        action: actions.onHideForOneHour,
      },
      // The ladder reads top to bottom as escalating quiet: hide for an hour,
      // only come when needed, off. Each step keeps drift alerts working.
      presenceMode === "drift_only"
        ? {
          id: "pet-presence-always",
          text: copy.stayAlways,
          action: () => actions.onPresenceModeChange("always"),
        }
        : {
          id: "pet-presence-drift-only",
          text: copy.showOnlyOnDrift,
          action: () => actions.onPresenceModeChange("drift_only"),
        },
      { item: "Separator" },
      {
        id: "pet-turn-off",
        text: copy.turnOffPet,
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

/**
 * A one-time follow-up to the pet menu's Turn Off: offer the quieter middle
 * step before the cat disappears for good. Native so it lands at the same
 * pointer the user just used; the caller decides when it has been shown.
 */
export async function openNativePetTurnOffSuggestionMenu(
  actions: {
    readonly onChooseDriftOnly: () => void;
    readonly onConfirmTurnOff: () => void;
  },
  state: PetModeNativeMenuState = {},
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const copy = petModeMenuCopy(state.language ?? resolveInitialDisplayLanguage());
  const menu = await Menu.new({
    items: [
      { id: "pet-turn-off-suggestion-header", text: copy.turnOffSuggestionHeader, enabled: false },
      {
        id: "pet-turn-off-suggestion-drift-only",
        text: copy.turnOffSuggestionDriftOnly,
        action: actions.onChooseDriftOnly,
      },
      {
        id: "pet-turn-off-suggestion-confirm",
        text: copy.turnOffSuggestionConfirm,
        action: actions.onConfirmTurnOff,
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
