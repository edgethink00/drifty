import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_STORAGE_KEY, resolveInitialTheme } from "../settings/settingsStorage";
import { resolveInitialDisplayLanguage, type DisplayLanguage } from "../localization/languagePreference";
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
import {
  automaticClosePausedConfirmationLabel,
  automaticClosePausedStateLabel,
  copyFor,
  isAutomaticClosePauseAction,
} from "./petModeQuickControlsCopy";
import {
  PET_QUICK_CONTROLS_ACKNOWLEDGE_MS,
  PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS,
} from "./petModeQuickControls";
import "./petModeQuickControls.css";

type FailedQuickControlsOperation =
  | { readonly kind: "quickControlsAction"; readonly action: PetQuickControlsAction }
  | { readonly kind: "hideOneHour" }
  | { readonly kind: "turnOff" }
  | { readonly kind: "menu"; readonly menu: "automaticClose" | "more" };

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
  const [phase, setPhase] = useState<"idle" | "acknowledging" | "failed">("idle");
  const [acknowledgement, setAcknowledgement] = useState<"automaticClosePause" | "hideOneHour" | null>(null);
  const menuBusyRef = useRef(false);
  const acknowledgeTimerRef = useRef<number | null>(null);
  const pendingPauseTimerRef = useRef<number | null>(null);
  const pendingPauseRef = useRef(false);
  const failedOperationRef = useRef<FailedQuickControlsOperation | null>(null);
  const hideBusyRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const preview = new URLSearchParams(window.location.search).get("petQuickControlsPreview");
    if (preview === "acknowledging") {
      setAcknowledgement("automaticClosePause");
      setPhase("acknowledging");
    }
    if (preview === "hideAcknowledging") {
      setAcknowledgement("hideOneHour");
      setPhase("acknowledging");
    }
    if (preview === "failed") setPhase("failed");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.surface = "pet-quick-controls";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.locale = language;
    document.documentElement.lang = language;
    document.documentElement.style.colorScheme = theme;
  }, [language, theme]);

  const clearAcknowledgeTimer = useCallback(() => {
    if (acknowledgeTimerRef.current === null) return;
    window.clearTimeout(acknowledgeTimerRef.current);
    acknowledgeTimerRef.current = null;
  }, []);

  const clearPendingPauseTimer = useCallback(() => {
    if (pendingPauseTimerRef.current === null) return;
    window.clearTimeout(pendingPauseTimerRef.current);
    pendingPauseTimerRef.current = null;
  }, []);

  const failAction = useCallback(() => {
    clearAcknowledgeTimer();
    clearPendingPauseTimer();
    pendingPauseRef.current = false;
    setAcknowledgement(null);
    setPhase("failed");
  }, [clearAcknowledgeTimer, clearPendingPauseTimer]);

  const dismissAfterAcknowledge = useCallback(() => {
    // The native hold has its own bounded failsafe. A failed dismissal must not
    // reject unhandled or replay the already-completed visibility action.
    void triggerNativePetQuickControlsAction("acknowledgeDismiss").catch(() => undefined).finally(() => {
      setAcknowledgement(null);
      setPhase("idle");
    });
  }, []);

  useEffect(() => {
    const applyPausedAcknowledgement = (
      nextOverride: PetQuickControlsAutomaticCloseOverridePayload | null,
    ) => {
      const failedOperation = failedOperationRef.current;
      const awaitingLatePauseConfirmation = failedOperation?.kind === "quickControlsAction"
        && isAutomaticClosePauseAction(failedOperation.action);
      if (
        (!pendingPauseRef.current && !awaitingLatePauseConfirmation)
        || !nextOverride
        || nextOverride.enabled
      ) return;
      clearPendingPauseTimer();
      pendingPauseRef.current = false;
      failedOperationRef.current = null;
      setAcknowledgement("automaticClosePause");
      setPhase("acknowledging");
    };
    const refresh = () => {
      const nextLanguage = resolveInitialDisplayLanguage();
      const savedEnabled = resolveAutomaticCloseEnabled();
      const override = resolveInitialAutomaticCloseOverride();
      setLanguage(nextLanguage);
      setTheme(resolveInitialTheme());
      setAutomaticCloseSavedEnabled(savedEnabled);
      setAutomaticCloseOverride(override);
      setAutomaticCloseEnabled(resolveEffectiveAutomaticCloseEnabled(savedEnabled, override));
      applyPausedAcknowledgement(override);
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
      applyPausedAcknowledgement(nextOverride);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("storage", handleStorage);
      unlisten?.();
      if (acknowledgeTimerRef.current !== null) {
        window.clearTimeout(acknowledgeTimerRef.current);
      }
      clearPendingPauseTimer();
    };
  }, [clearPendingPauseTimer]);

  useEffect(() => {
    if (phase !== "acknowledging") {
      clearAcknowledgeTimer();
      return undefined;
    }
    acknowledgeTimerRef.current = window.setTimeout(() => {
      acknowledgeTimerRef.current = null;
      dismissAfterAcknowledge();
    }, PET_QUICK_CONTROLS_ACKNOWLEDGE_MS);
    return () => {
      clearAcknowledgeTimer();
    };
  }, [acknowledgement, clearAcknowledgeTimer, dismissAfterAcknowledge, phase]);

  const runNativeMenu = useCallback(async (
    kind: "automaticClose" | "more",
    open: () => Promise<boolean>,
  ) => {
    if (menuBusyRef.current) return;
    const operation: FailedQuickControlsOperation = { kind: "menu", menu: kind };
    failedOperationRef.current = operation;
    menuBusyRef.current = true;
    setOpenMenu(kind);
    await setNativePetQuickControlsMenuOpen(true).catch(() => undefined);
    try {
      const opened = await open();
      if (!opened) throw new Error(`Could not open ${kind} menu`);
      if (failedOperationRef.current === operation) failedOperationRef.current = null;
    } catch {
      failAction();
    } finally {
      setOpenMenu(null);
      await setNativePetQuickControlsMenuOpen(false).catch(() => undefined);
      menuBusyRef.current = false;
    }
  }, [failAction]);

  const handleQuickControlsAction = useCallback((action: PetQuickControlsAction) => {
    const operation: FailedQuickControlsOperation = { kind: "quickControlsAction", action };
    failedOperationRef.current = operation;
    if (isAutomaticClosePauseAction(action)) {
      pendingPauseRef.current = true;
      setPhase("idle");
      clearPendingPauseTimer();
      pendingPauseTimerRef.current = window.setTimeout(() => {
        pendingPauseTimerRef.current = null;
        if (pendingPauseRef.current && failedOperationRef.current === operation) failAction();
      }, PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS);
    } else {
      pendingPauseRef.current = false;
      clearPendingPauseTimer();
      if (phase === "failed") setPhase("idle");
    }
    void triggerNativePetQuickControlsAction(action).then(() => {
      if (!isAutomaticClosePauseAction(action) && failedOperationRef.current === operation) {
        failedOperationRef.current = null;
      }
    }).catch(() => {
      failedOperationRef.current = operation;
      failAction();
    });
  }, [clearPendingPauseTimer, failAction, phase]);

  const handleHideOneHour = useCallback(() => {
    if (hideBusyRef.current) return;
    const operation: FailedQuickControlsOperation = { kind: "hideOneHour" };
    failedOperationRef.current = operation;
    hideBusyRef.current = true;
    pendingPauseRef.current = false;
    clearPendingPauseTimer();
    void triggerNativePetVisibilityAction("hideOneHour", {
      keepQuickControlsVisible: true,
    }).then(() => {
      hideBusyRef.current = false;
      if (failedOperationRef.current === operation) failedOperationRef.current = null;
      setAcknowledgement("hideOneHour");
      setPhase("acknowledging");
    }).catch(() => {
      hideBusyRef.current = false;
      failedOperationRef.current = operation;
      failAction();
    });
  }, [clearPendingPauseTimer, failAction]);

  const handleTurnOffPet = useCallback(() => {
    const operation: FailedQuickControlsOperation = { kind: "turnOff" };
    failedOperationRef.current = operation;
    void triggerNativePetVisibilityAction("turnOff").then(() => {
      if (failedOperationRef.current === operation) failedOperationRef.current = null;
    }).catch(() => {
      failedOperationRef.current = operation;
      failAction();
    });
  }, [failAction]);

  const handleOpenMenu = useCallback(() => {
    void runNativeMenu("more", () => openNativePetModeMenu({
          onOpenDashboard: () => {
            handleQuickControlsAction("openDashboard");
          },
          onOpenSettings: () => {
            handleQuickControlsAction("openSettings");
          },
          onHideForOneHour: handleHideOneHour,
          onTurnOffPet: handleTurnOffPet,
        }, { language }));
  }, [handleHideOneHour, handleQuickControlsAction, handleTurnOffPet, language, runNativeMenu]);

  const handleOpenAutomaticCloseMenu = useCallback(() => {
    void runNativeMenu("automaticClose", () => openNativeAutomaticCloseMenu((action) => {
      handleQuickControlsAction(action);
    }, {
      savedEnabled: automaticCloseSavedEnabled,
      override: automaticCloseOverride,
      language,
    }));
  }, [automaticCloseOverride, automaticCloseSavedEnabled, handleQuickControlsAction, language, runNativeMenu]);

  const handleRetryFailedAction = useCallback(() => {
    const operation = failedOperationRef.current;
    setPhase("idle");
    if (!operation) return;
    if (operation.kind === "hideOneHour") {
      handleHideOneHour();
      return;
    }
    if (operation.kind === "turnOff") {
      handleTurnOffPet();
      return;
    }
    if (operation.kind === "menu") {
      if (operation.menu === "automaticClose") handleOpenAutomaticCloseMenu();
      else handleOpenMenu();
      return;
    }
    handleQuickControlsAction(operation.action);
  }, [handleHideOneHour, handleOpenAutomaticCloseMenu, handleOpenMenu, handleQuickControlsAction, handleTurnOffPet]);

  const automaticCloseDescription = copyFor(
    language,
    automaticCloseEnabled
      ? "settings.pet.automaticCloseOnDescription"
      : "settings.pet.automaticCloseOffDescription",
  );
  const paused = Boolean(automaticCloseOverride && !automaticCloseOverride.enabled);
  const pausedState = automaticClosePausedStateLabel(language, automaticCloseOverride);
  const pausedConfirmation = automaticClosePausedConfirmationLabel(language, automaticCloseOverride);
  const automaticCloseState = paused
    ? pausedState
    : copyFor(
      language,
      automaticCloseOverride?.enabled
        ? "pet.quickControls.automaticCloseTemporaryOn"
        : automaticCloseEnabled
          ? "pet.quickControls.automaticCloseOn"
          : "pet.quickControls.automaticCloseOff",
    );
  const automaticCloseVisibleState = paused
    ? copyFor(language, "pet.quickControls.automaticClosePaused")
    : automaticCloseOverride?.enabled
      ? copyFor(language, "pet.quickControls.automaticCloseOn")
      : automaticCloseState;
  const acknowledgementCopy = acknowledgement === "hideOneHour"
    ? copyFor(language, "pet.quickControls.hideOneHourConfirmed")
    : pausedConfirmation;
  const showingAcknowledgement = phase === "acknowledging"
    && (acknowledgement === "hideOneHour" || paused);
  const showingFailure = phase === "failed";
  const failureCopy = copyFor(language, "pet.quickControls.actionFailed");
  return (
    <div
      className="pet-quick-controls"
      role="toolbar"
      aria-label={copyFor(language, "pet.quickControls.label")}
      data-phase={phase === "idle" ? undefined : phase}
    >
      {showingAcknowledgement ? (
        <div
          className="pet-quick-controls__ack"
          role="status"
          data-override={acknowledgement === "automaticClosePause" ? "true" : undefined}
          data-acknowledgement={acknowledgement ?? undefined}
        >
          <span
            className="pet-quick-controls__feedback-icon pet-quick-controls__feedback-icon--success"
            aria-hidden="true"
          >
            <svg viewBox="0 0 12 12" focusable="false">
              <path d="m2.5 6.1 2.1 2.1 4.9-4.8" />
            </svg>
          </span>
          <span className="pet-quick-controls__label">{acknowledgementCopy}</span>
        </div>
      ) : showingFailure ? (
        <>
          <div className="pet-quick-controls__ack pet-quick-controls__ack--failed" role="alert">
            <span
              className="pet-quick-controls__feedback-icon pet-quick-controls__feedback-icon--failed"
              aria-hidden="true"
            >
              <svg viewBox="0 0 12 12" focusable="false">
                <path d="M6 3.1v3.7" />
                <circle cx="6" cy="8.8" r=".7" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="pet-quick-controls__label">{failureCopy}</span>
          </div>
          <span className="pet-quick-controls__divider" aria-hidden="true" />
          <button
            type="button"
            className="pet-quick-controls__action pet-quick-controls__retry"
            onClick={handleRetryFailedAction}
          >
            {copyFor(language, "pet.quickControls.actionRetry")}
          </button>
        </>
      ) : (
        <>
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
        <span className="pet-quick-controls__text">
          <span className="pet-quick-controls__label">{copyFor(language, "pet.quickControls.automaticClose")}</span>
          <span className="pet-quick-controls__state">{automaticCloseVisibleState}</span>
        </span>
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
        </>
      )}
      <span
        id="pet-quick-controls-automatic-close-description"
        className="pet-quick-controls__sr-only"
      >
        {automaticCloseDescription}
      </span>
    </div>
  );
}
