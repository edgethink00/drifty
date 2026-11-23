import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyHint } from "../../components/KeyHint";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { DeviceSyncEnableOptions } from "./deviceSyncTypes";
import "./DeviceSyncSetupModal.css";

/** This device's earlier records went to another account; the account they would now go to. */
export type DeviceSyncEarlierRecords = {
  readonly account: string | null;
};

/**
 * Keep the setting brief; explain the upload before a device opts in. A device
 * that synced with another account before also asks whether its earlier
 * records come along; leaving the box clear keeps them out of this account.
 */
export function DeviceSyncSetupModal({ mode, canEnable, earlierRecords = null, onClose, onEnable }: {
  readonly mode: "info" | "enable" | null;
  readonly canEnable: boolean;
  readonly earlierRecords?: DeviceSyncEarlierRecords | null;
  readonly onClose: () => void;
  readonly onEnable: (options: DeviceSyncEnableOptions) => void;
}) {
  const { t } = useLocalization();
  const overlayDismiss = useOverlayDismiss(onClose);
  const [includeEarlierRecords, setIncludeEarlierRecords] = useState(false);
  // Each opening starts unchecked: sending another account's history is never carried over.
  const [openedMode, setOpenedMode] = useState(mode);
  if (openedMode !== mode) {
    setOpenedMode(mode);
    if (mode === "enable") setIncludeEarlierRecords(false);
  }
  const offerEarlierRecords = mode === "enable" && earlierRecords !== null;
  return createPortal(
    <ModalPresence onDismiss={onClose} explicitTabNavigation>
      {mode ? (
        <div className="auth-modal__overlay" {...overlayDismiss}>
          <section className="auth-modal modal-shell device-sync-setup-modal" data-modal-variant="compact"
            role="dialog" aria-modal="true" aria-labelledby="device-sync-setup-title"
            aria-describedby="device-sync-setup-description">
            <div className="auth-modal__header">
              <h2 id="device-sync-setup-title">{t(mode === "enable" ? "settings.account.syncEnableTitle" : "settings.account.deviceSync")}</h2>
              <p id="device-sync-setup-description">{t("settings.account.syncUploadDescription")}</p>
            </div>
            {offerEarlierRecords ? (
              <label className="device-sync-setup-modal__earlier">
                <input type="checkbox" checked={includeEarlierRecords}
                  onChange={(event) => setIncludeEarlierRecords(event.currentTarget.checked)} />
                <span>
                  {t("settings.account.syncEarlierRecords")}
                  <span className="device-sync-setup-modal__earlier-detail">
                    {earlierRecords.account
                      ? t("settings.account.syncEarlierRecordsDetail", { account: earlierRecords.account })
                      : t("settings.account.syncEarlierRecordsDetailNoAccount")}
                  </span>
                </span>
              </label>
            ) : null}
            <details className="device-sync-setup-modal__details">
              <summary>{t("settings.account.syncDetails")}</summary>
              <p>{t("settings.account.syncScope")}</p>
              <p>{t("settings.account.syncTiming")}</p>
              <p>{t("settings.account.syncRetention")}</p>
            </details>
            <div className="device-sync-setup-modal__actions">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
                {t(mode === "enable" ? "common.cancel" : "settings.account.syncClose")}
                <KeyHint shortcut="escape" />
              </button>
              {mode === "enable" ? (
                <button type="button" className="modal-btn modal-btn--primary" disabled={!canEnable}
                  onClick={() => {
                    if (canEnable) onEnable({ includeEarlierRecords: offerEarlierRecords && includeEarlierRecords });
                  }}>
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
