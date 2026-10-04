import { createPortal } from "react-dom";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";

/** Keep the setting brief; explain the upload before a device opts in. */
export function DeviceSyncSetupModal({ mode, canEnable, onClose, onEnable }: {
  readonly mode: "info" | "enable" | null;
  readonly canEnable: boolean;
  readonly onClose: () => void;
  readonly onEnable: () => void;
}) {
  const { t } = useLocalization();
  return createPortal(
    <ModalPresence onDismiss={onClose} explicitTabNavigation>
      {mode ? (
        <div className="auth-modal__overlay" onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}>
          <section className="auth-modal modal-shell device-sync-setup-modal" data-modal-variant="compact"
            role="dialog" aria-modal="true" aria-labelledby="device-sync-setup-title"
            aria-describedby="device-sync-setup-description">
            <div className="auth-modal__header">
              <h2 id="device-sync-setup-title">{t(mode === "enable" ? "settings.account.syncEnableTitle" : "settings.account.deviceSync")}</h2>
              <p id="device-sync-setup-description">{t("settings.account.syncUploadDescription")}</p>
            </div>
            <details className="device-sync-setup-modal__details">
              <summary>{t("settings.account.syncDetails")}</summary>
              <p>{t("settings.account.syncScope")}</p>
              <p>{t("settings.account.syncTiming")}</p>
              <p>{t("settings.account.syncRetention")}</p>
            </details>
            <div className="device-sync-setup-modal__actions">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
                {t(mode === "enable" ? "common.cancel" : "settings.account.syncClose")}
              </button>
              {mode === "enable" ? (
                <button type="button" className="modal-btn modal-btn--primary" disabled={!canEnable}
                  onClick={() => { if (canEnable) onEnable(); }}>
                  {t("settings.account.syncEnable")}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </ModalPresence>,
    document.body,
  );
}
