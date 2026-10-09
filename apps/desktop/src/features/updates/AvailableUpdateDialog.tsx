import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { useEffect, useId, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import type { UpdatePolicy } from "./updatePolicy";
import "./AvailableUpdateDialog.css";

type AvailableUpdateDialogUpdate = {
  body?: string | null;
  date?: string | null;
  version: string;
};

type UpdateChannel = "stable" | "developer";

export type AvailableUpdateDialogProps = {
  updateChannel: UpdateChannel;
  isWindows: boolean;
  backgroundUpdatesEnabled: boolean;
  policy: UpdatePolicy | null;
  update: AvailableUpdateDialogUpdate;
  updaterChecking: boolean;
  updaterError: string | null;
  updaterInstalling: boolean;
  onBackgroundUpdatesEnabledChange: (enabled: boolean) => void;
  onDismiss: () => void;
  onInstall: () => void;
};

type NativeUpdatePromptResult = {
  readonly backgroundUpdatesEnabled: boolean;
  readonly confirmed: boolean;
};

type ActiveUpdateWindow = {
  readonly owner: UpdateChannel;
  readonly prompt: Promise<NativeUpdatePromptResult | null>;
  readonly version: string;
};

let activeUpdateWindow: ActiveUpdateWindow | null = null;

function showNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
  language: DisplayLanguage,
) {
  return invoke<NativeUpdatePromptResult | null>("update_prompt_show_native", {
    backgroundUpdatesEnabled,
    language,
    message,
    version,
    urgent,
  });
}

function getNativeUpdatePrompt(
  owner: UpdateChannel,
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
  language: DisplayLanguage,
) {
  // The channel survives auth/onboarding shell remounts and StrictMode.
  // Another updater must never share its confirmation or open a competing window.
  if (activeUpdateWindow) {
    return activeUpdateWindow.owner === owner && activeUpdateWindow.version === version
      ? activeUpdateWindow.prompt
      : Promise.resolve(null);
  }

  const prompt = showNativeUpdatePrompt(version, urgent, message, backgroundUpdatesEnabled, language).finally(() => {
    if (activeUpdateWindow?.prompt === prompt) activeUpdateWindow = null;
  });
  activeUpdateWindow = { owner, prompt, version };
  return prompt;
}

export function AvailableUpdateDialog({
  updateChannel,
  isWindows,
  backgroundUpdatesEnabled,
  policy,
  update,
  updaterChecking,
  updaterError,
  updaterInstalling,
  onBackgroundUpdatesEnabledChange,
  onDismiss,
  onInstall,
}: AvailableUpdateDialogProps) {
  const { effectiveLanguage } = useLocalization();
  const urgent = policy?.urgency === "urgent" || updaterError !== null;
  const message = policy?.message ?? update.body ?? null;

  useEffect(() => {
    if (isWindows || updaterChecking || updaterInstalling) return;

    let subscribed = true;

    void getNativeUpdatePrompt(updateChannel, update.version, urgent, message, backgroundUpdatesEnabled, effectiveLanguage).then((result) => {
      if (!subscribed) return;
      if (!result) {
        onDismiss();
        return;
      }
      onBackgroundUpdatesEnabledChange(result.backgroundUpdatesEnabled);
      if (result.confirmed) {
        onInstall();
        onDismiss();
        return;
      }
      onDismiss();
    }).catch((error: unknown) => {
      if (!subscribed) return;
      if (error instanceof Error) {
        console.warn(`Failed to show update window: ${error.message}`);
      } else {
        console.warn("Failed to show update window.");
      }
      onDismiss();
    });

    return () => {
      subscribed = false;
    };
  }, [
    backgroundUpdatesEnabled,
    updateChannel,
    effectiveLanguage,
    message,
    onBackgroundUpdatesEnabledChange,
    onDismiss,
    onInstall,
    update.version,
    urgent,
    isWindows,
    updaterChecking,
    updaterInstalling,
  ]);

  if (isWindows && !updaterChecking && !updaterInstalling) {
    return (
      <WindowsUpdatePrompt
        version={update.version}
        message={message}
        error={updaterError}
        onDismiss={onDismiss}
        onInstall={onInstall}
      />
    );
  }

  return null;
}

function WindowsUpdatePrompt({ version, message, error, onDismiss, onInstall }: {
  readonly version: string;
  readonly message: string | null;
  readonly error: string | null;
  readonly onDismiss: () => void;
  readonly onInstall: () => void;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useModalDismiss(onDismiss);
  const overlayDismiss = useOverlayDismiss(onDismiss);
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".windows-update-prompt__later" });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell windows-update-prompt"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header">
          <h2 id={titleId}>{t("updates.promptTitle", { version })}</h2>
          <p>{t("updates.promptBody")}</p>
        </div>
        {message ? <p className="windows-update-prompt__notes">{message}</p> : null}
        {error ? <p className="auth-modal__error" role="alert">{error}</p> : null}
        <div className="windows-update-prompt__actions">
          <button type="button" className="modal-btn modal-btn--ghost windows-update-prompt__later" onClick={onDismiss}>{t("updates.later")}</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={() => { onInstall(); onDismiss(); }}>{t("updates.install")}</button>
        </div>
      </section>
    </div>
  );
}
