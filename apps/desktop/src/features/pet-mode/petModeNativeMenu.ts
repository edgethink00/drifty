import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import type { DisplayLanguage } from "../localization/languageCatalog";
import { Menu, MenuItem, Submenu, type MenuItemOptions, type MenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../companion/watcherBridge";
import { resolveInitialDisplayLanguage } from "../localization/languagePreference";
import { resolveInitialAutomaticCloseOverride } from "../companion/automaticCloseOverride";
import { resolveInitialDriftAlertsEnabled, resolveInitialExtremeNudgeEnabled } from "../companion/driftAlarmData";
import { automaticClosePausedStateLabel, copyFor } from "./petModeQuickControlsCopy";
import { getNativePetQuickControlsState, triggerNativePetQuickControlsAction } from "./petModeBridge";
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
  readonly language?: DisplayLanguage;
  readonly presenceMode?: PetPresenceMode;
};

export type PetModeAutomaticCloseMenuState = {
  readonly savedEnabled: boolean;
  readonly override: PetQuickControlsAutomaticCloseOverridePayload | null;
  readonly language?: DisplayLanguage;
};

type MenuItems = NonNullable<MenuOptions["items"]>;

async function retainMenuItems(items: MenuItems, owned: (MenuItem | Submenu)[]): Promise<MenuItems> {
  const retained: MenuItems = [];
  for (const item of items) {
    // Tauri drops inline action channels after append. Own every actionable
    // item, including submenu children, through native popup dismissal.
    if (!("rid" in item) && "items" in item && item.items) {
      const children = await retainMenuItems(item.items, owned);
      const submenu = await Submenu.new({ ...item, items: children });
      owned.push(submenu);
      retained.push(submenu);
    } else if (!("rid" in item) && "action" in item && typeof item.action === "function") {
      const resource = await MenuItem.new(item as MenuItemOptions);
      owned.push(resource);
      retained.push(resource);
    } else {
      retained.push(item);
    }
  }
  return retained;
}

async function popupPetMenu(items: MenuItems): Promise<boolean> {
  const ownedItems: (MenuItem | Submenu)[] = [];
  let menu: Menu | undefined;
  let operationFailed = false;
  try {
    menu = await Menu.new({ items: await retainMenuItems(items, ownedItems) });
    await menu.popup(undefined, getCurrentWindow());
    return true;
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    // Attempt every release even after partial construction or popup failure.
    // Preserve the original operation error if cleanup also fails.
    const released = await Promise.allSettled([
      ...(menu ? [menu.close()] : []),
      ...ownedItems.map((item) => item.close()),
    ]);
    const failed = released.find((result) => result.status === "rejected");
    if (!operationFailed && failed?.status === "rejected") throw failed.reason;
  }
}

function legacyPetModeMenuCopy(language: "en" | "ko" | "es") {
  if (language === "ko") {
    return {
      openDashboard: "Drifty 열기",
      openSettings: "펫 설정…",
      hideOneHour: "펫 1시간 숨기기",
      showOnlyOnDrift: "딴짓할 때만 나타나기",
      stayAlways: "항상 함께 있기",
      turnOffPet: "펫 끄기",
      turnOffSuggestionHeader: "펫을 완전히 끌까요?",
      turnOffSuggestionDriftOnly: "딴짓할 때만 나타나기",
      turnOffSuggestionConfirm: "완전히 끄기",
    };
  }
  if (language === "es") {
    return {
      openDashboard: "Abrir Drifty",
      openSettings: "Configuración de la mascota…",
      hideOneHour: "Ocultar la mascota 1 hora",
      showOnlyOnDrift: "Mostrar solo al distraerme",
      stayAlways: "Mantener en pantalla",
      turnOffPet: "Desactivar la mascota",
      turnOffSuggestionHeader: "¿Desactivar la mascota por completo?",
      turnOffSuggestionDriftOnly: "Mostrar solo al distraerme",
      turnOffSuggestionConfirm: "Desactivar",
    };
  }
  return {
    openDashboard: "Open Drifty",
    openSettings: "Pet Settings…",
    hideOneHour: "Hide Pet for 1 Hour",
    showOnlyOnDrift: "Show Only When Drifting",
    stayAlways: "Stay On Screen",
    turnOffPet: "Turn Off Pet",
    turnOffSuggestionHeader: "Turn the pet off completely?",
    turnOffSuggestionDriftOnly: "Show Only When Drifting",
    turnOffSuggestionConfirm: "Turn Off",
  };
}

function legacyAutomaticCloseMenuCopy(language: "en" | "ko" | "es") {
  if (language === "ko") {
    return {
      pause15: "15분 멈추기",
      pause60: "1시간 멈추기",
      pauseToday: "자정까지 멈추기",
      pauseForever: "다시 켤 때까지 멈추기",
      turnOn: "자동 닫기 켜기",
      restoreOn: "지금 다시 켜기",
      restoreOff: "지금 다시 끄기",
    };
  }
  if (language === "es") {
    return {
      pause15: "Pausar 15 minutos",
      pause60: "Pausar 1 hora",
      pauseToday: "Pausar hasta medianoche",
      pauseForever: "Pausar hasta reanudar",
      turnOn: "Activar cierre automático",
      restoreOn: "Reactivar ahora",
      restoreOff: "Desactivar ahora",
    };
  }
  return {
    pause15: "Pause for 15 Minutes",
    pause60: "Pause for 1 Hour",
    pauseToday: "Pause Until Midnight",
    pauseForever: "Pause Until Resumed",
    turnOn: "Turn On Auto-close",
    restoreOn: "Turn Back On Now",
    restoreOff: "Turn Back Off Now",
  };
}

function automaticCloseMenuItems(
  onAction: (action: PetQuickControlsAction) => void,
  state: PetModeAutomaticCloseMenuState,
): MenuItems {
  const copy = automaticCloseMenuCopy(state.language ?? resolveInitialDisplayLanguage());
  const item = (id: string, text: string, action: PetQuickControlsAction) => ({
    id, text, action: () => onAction(action),
  });
  if (state.override) {
    return [item("pet-auto-close-restore", state.savedEnabled ? copy.restoreOn : copy.restoreOff, "automaticCloseRestore")];
  }
  if (!state.savedEnabled) {
    return [item("pet-auto-close-turn-on", copy.turnOn, "automaticCloseTurnOn")];
  }
  return [
    item("pet-auto-close-pause-15", copy.pause15, "automaticClosePause15"),
    item("pet-auto-close-pause-60", copy.pause60, "automaticClosePause60"),
    item("pet-auto-close-pause-today", copy.pauseToday, "automaticClosePauseToday"),
    item("pet-auto-close-pause-forever", copy.pauseForever, "automaticClosePauseForever"),
  ];
}

export async function openNativeAutomaticCloseMenu(
  onAction: (action: PetQuickControlsAction) => void,
  state: PetModeAutomaticCloseMenuState,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return popupPetMenu(automaticCloseMenuItems(onAction, state));
}

async function automaticCloseSubmenu(language: DisplayLanguage) {
  const current = await getNativePetQuickControlsState().catch(() => null);
  const savedEnabled = current?.automaticCloseSavedEnabled
    ?? (resolveInitialDriftAlertsEnabled() && resolveInitialExtremeNudgeEnabled());
  let override = current ? current.automaticCloseOverride : resolveInitialAutomaticCloseOverride();
  if (override?.endsAtMs != null && override.endsAtMs <= Date.now()) override = null;
  const status = override
    ? override.enabled
      ? copyFor(language, "pet.quickControls.automaticCloseTemporaryOn")
      : automaticClosePausedStateLabel(language, override)
    : copyFor(language, savedEnabled ? "pet.quickControls.automaticCloseOn" : "pet.quickControls.automaticCloseOff");
  return {
    id: "pet-automatic-close",
    text: `${copyFor(language, "pet.quickControls.automaticClose")} · ${status}`,
    items: automaticCloseMenuItems((action) => {
      void triggerNativePetQuickControlsAction(action).catch(() => undefined);
    }, { savedEnabled, override, language }),
  };
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

  const language = state.language ?? resolveInitialDisplayLanguage();
  const copy = petModeMenuCopy(language);
  const presenceMode = state.presenceMode ?? "always";
  return popupPetMenu([
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
    await automaticCloseSubmenu(language),
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
  ]);
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
  return popupPetMenu([
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
  ]);
}

function translatedMenu<T extends Record<string, string>>(copy: T, language: DisplayLanguage): T {
  return Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, supplementalText(language, value)])) as T;
}
function petModeMenuCopy(language: DisplayLanguage) {
  return isAdditionalDisplayLanguage(language) ? translatedMenu(legacyPetModeMenuCopy("en"), language) : legacyPetModeMenuCopy(language);
}
function automaticCloseMenuCopy(language: DisplayLanguage) {
  return isAdditionalDisplayLanguage(language) ? translatedMenu(legacyAutomaticCloseMenuCopy("en"), language) : legacyAutomaticCloseMenuCopy(language);
}
