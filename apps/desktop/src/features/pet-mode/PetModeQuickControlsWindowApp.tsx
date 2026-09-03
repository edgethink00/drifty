import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_STORAGE_KEY, resolveInitialTheme } from "../settings/settingsStorage";
import { resolveInitialDisplayLanguage, type DisplayLanguage } from "../localization/languagePreference";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "../localization/translations";
import { EXTREME_NUDGE_STORAGE_KEY } from "../companion/extremeNudgeData";
import { DRIFT_ALERTS_STORAGE_KEY } from "../companion/driftAlarmData";
import {
  AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
  resolveEffectiveAutomaticCloseEnabled,
  resolveInitialAutomaticCloseOverride,
} from "../companion/automaticCloseOverride";
import { openNativeAutomaticCloseMenu, openNativePetModeMenu } from "./petModeNativeMenu";
import {
  listenToNativePetQuickControlsState,
  setNativePetQuickControlsMenuOpen,
  triggerNativePetQuickControlsAction,
  triggerNativePetVisibilityAction,
  type PetQuickControlsAction,
  type PetQuickControlsAutomaticCloseOverridePayload,
} from "./petModeBridge";
import "./petModeQuickControls.css";

function copyFor(language: DisplayLanguage, key: TranslationKey): string {
  return language === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key];
}

function resolveAutomaticCloseEnabled(): boolean {
  try {
    return window.localStorage.getItem(EXTREME_NUDGE_STORAGE_KEY) === "1"
      && window.localStorage.getItem(DRIFT_ALERTS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function activeOverride(
  override: PetQuickControlsAutomaticCloseOverridePayload | null,
): PetQuickControlsAutomaticCloseOverridePayload | null {
  if (override && override.endsAtMs !== null && override.endsAtMs <= Date.now()) return null;
  return override;
}

export function PetModeQuickControlsWindowApp() {
  const [language, setLanguage] = useState<DisplayLanguage>(resolveInitialDisplayLanguage);
  const [theme, setTheme] = useState(resolveInitialTheme);
  const [automaticCloseSavedEnabled, setAutomaticCloseSavedEnabled] = useState(resolveAutomaticCloseEnabled);
  const [automaticCloseOverride, setAutomaticCloseOverride] = useState<PetQuickControlsAutomaticCloseOverridePayload | null>(
    resolveInitialAutomaticCloseOverride,
  );
  const [automaticCloseEnabled, setAutomaticCloseEnabled] = useState(() => resolveEffectiveAutomaticCloseEnabled(
    resolveAutomaticCloseEnabled(),
    resolveInitialAutomaticCloseOverride(),
  ));
  const [openMenu, setOpenMenu] = useState<"automaticClose" | "more" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const menuBusyRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.surface = "pet-quick-controls";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.locale = language;
    document.documentElement.lang = language;
    document.documentElement.style.colorScheme = theme;
  }, [language, theme]);

  useEffect(() => {
    const refresh = () => {
      setLanguage(resolveInitialDisplayLanguage());
      setTheme(resolveInitialTheme());
      const savedEnabled = resolveAutomaticCloseEnabled();
      const override = resolveInitialAutomaticCloseOverride();
      setAutomaticCloseSavedEnabled(savedEnabled);
      setAutomaticCloseOverride(override);
      setAutomaticCloseEnabled(resolveEffectiveAutomaticCloseEnabled(savedEnabled, override));
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null
        || event.key === THEME_STORAGE_KEY
        || event.key === EXTREME_NUDGE_STORAGE_KEY
        || event.key === DRIFT_ALERTS_STORAGE_KEY
        || event.key === AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY
        || event.key === "drifty.displayLanguage"
      ) refresh();
    };
    window.addEventListener("storage", handleStorage);
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetQuickControlsState((state) => {
      if (disposed) return;
      const nextOverride = activeOverride(state.automaticCloseOverride);
      setAutomaticCloseEnabled(state.automaticCloseEnabled);
      setAutomaticCloseSavedEnabled(state.automaticCloseSavedEnabled);
      setAutomaticCloseOverride(nextOverride);
      setLanguage(state.language);
      setTheme(state.theme);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("storage", handleStorage);
      unlisten?.();
    };
  }, []);

  const runNativeMenu = useCallback(async (
    kind: "automaticClose" | "more",
    open: () => Promise<boolean>,
  ) => {
    if (menuBusyRef.current) return;
    menuBusyRef.current = true;
    setOpenMenu(kind);
    await setNativePetQuickControlsMenuOpen(true).catch(() => undefined);
    try {
      await open();
    } catch {
      setAnnouncement(copyFor(language, "pet.quickControls.actionFailed"));
    } finally {
      setOpenMenu(null);
      await setNativePetQuickControlsMenuOpen(false).catch(() => undefined);
      menuBusyRef.current = false;
    }
  }, [language]);

  const handleQuickControlsAction = useCallback((action: PetQuickControlsAction) => {
    void triggerNativePetQuickControlsAction(action).catch(() => {
      setAnnouncement(copyFor(language, "pet.quickControls.actionFailed"));
    });
  }, [language]);

  const handleHideOneHour = useCallback(() => {
    void triggerNativePetVisibilityAction("hideOneHour").catch(() => {
      setAnnouncement(copyFor(language, "pet.quickControls.actionFailed"));
    });
  }, [language]);
  const handleOpenMenu = useCallback(() => {
    void runNativeMenu("more", () => openNativePetModeMenu({
          onOpenDashboard: () => {
            handleQuickControlsAction("openDashboard");
          },
          onOpenSettings: () => {
            handleQuickControlsAction("openSettings");
          },
          onHideForOneHour: handleHideOneHour,
          onTurnOffPet: () => {
            void triggerNativePetVisibilityAction("turnOff").catch(() => {
              setAnnouncement(copyFor(language, "pet.quickControls.actionFailed"));
            });
          },
        }, { language }));
  }, [handleHideOneHour, handleQuickControlsAction, language, runNativeMenu]);

  const handleOpenAutomaticCloseMenu = useCallback(() => {
    void runNativeMenu("automaticClose", () => openNativeAutomaticCloseMenu((action) => {
      handleQuickControlsAction(action);
    }, {
      savedEnabled: automaticCloseSavedEnabled,
      override: automaticCloseOverride,
      language,
    }));
  }, [automaticCloseOverride, automaticCloseSavedEnabled, handleQuickControlsAction, language, runNativeMenu]);

  const automaticCloseDescription = copyFor(
    language,
    automaticCloseEnabled
      ? "settings.pet.automaticCloseOnDescription"
      : "settings.pet.automaticCloseOffDescription",
  );
  const automaticCloseState = copyFor(
    language,
    automaticCloseOverride && !automaticCloseOverride.enabled
      ? "pet.quickControls.automaticClosePaused"
      : automaticCloseOverride?.enabled
        ? "pet.quickControls.automaticCloseTemporaryOn"
        : automaticCloseEnabled
          ? "pet.quickControls.automaticCloseOn"
          : "pet.quickControls.automaticCloseOff",
  );
  const automaticCloseVisibleState = automaticCloseOverride?.enabled
    ? copyFor(language, "pet.quickControls.automaticCloseOn")
    : automaticCloseState;

  return (
    <div className="pet-quick-controls" role="toolbar" aria-label={copyFor(language, "pet.quickControls.label")}>
      <button
        type="button"
        className="pet-quick-controls__toggle"
        aria-label={`${copyFor(language, "pet.quickControls.automaticClose")}: ${automaticCloseState}`}
        aria-describedby="pet-quick-controls-automatic-close-description"
        aria-haspopup="menu"
        aria-expanded={openMenu === "automaticClose"}
        data-effective={automaticCloseEnabled ? "on" : "off"}
        data-override={automaticCloseOverride ? "true" : "false"}
        data-open={openMenu === "automaticClose" ? "true" : undefined}
        title={automaticCloseDescription}
        onClick={handleOpenAutomaticCloseMenu}
      >
        <span className="pet-quick-controls__status-dot" aria-hidden="true" />
        <span className="pet-quick-controls__label">{copyFor(language, "pet.quickControls.automaticClose")}</span>
        <span className="pet-quick-controls__state">{automaticCloseVisibleState}</span>
        <svg className="pet-quick-controls__chevron" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="pet-quick-controls__divider" aria-hidden="true" />
      <button
        type="button"
        className="pet-quick-controls__action"
        title={copyFor(language, "pet.quickControls.hideOneHour")}
        onClick={handleHideOneHour}
      >
        {copyFor(language, "pet.quickControls.hideOneHour")}
      </button>
      <span className="pet-quick-controls__divider" aria-hidden="true" />
      <button
        type="button"
        className="pet-quick-controls__more"
        aria-label={copyFor(language, "pet.quickControls.more")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "more"}
        data-open={openMenu === "more" ? "true" : undefined}
        onClick={handleOpenMenu}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      <span
        id="pet-quick-controls-automatic-close-description"
        className="pet-quick-controls__sr-only"
      >
        {automaticCloseDescription}
      </span>
      <span className="pet-quick-controls__sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
