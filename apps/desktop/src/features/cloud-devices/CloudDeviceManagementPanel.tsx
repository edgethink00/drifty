import { useState } from "react";

import type { BillingEntitlement } from "../billing/billingService";
import type { CloudDeviceRecord } from "./cloudDeviceService";
import "./CloudDeviceManagementPanel.css";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import { ModalPresence } from "../../components/ModalPresence";

export type CloudDeviceManagementPanelProps = {
  readonly access: BillingEntitlement["deviceAccess"] | null;
  readonly actionError: string | null;
  readonly devices: readonly CloudDeviceRecord[];
  readonly isRefreshing: boolean;
  readonly revokingId: string | null;
  readonly onRefresh: () => void | Promise<unknown>;
  readonly onRevoke: (deviceId: string) => void | Promise<void>;
};

export function CloudDeviceManagementPanel({
  access,
  actionError,
  devices,
  isRefreshing,
  revokingId,
  onRefresh,
  onRevoke,
}: CloudDeviceManagementPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const refreshLabel = isRefreshing ? t("settings.cloudDevices.refreshingAria") : t("settings.cloudDevices.refreshAria");
  const [pendingRemovalDevice, setPendingRemovalDevice] = useState<CloudDeviceRecord | null>(null);
  const accessMessage = access && !access.allowed && access.message ? access.message : null;

  function confirmDeviceRemoval() {
    if (pendingRemovalDevice === null) return;
    const deviceId = pendingRemovalDevice.id;
    setPendingRemovalDevice(null);
    void onRevoke(deviceId);
  }

  return (
    <section className="cloud-device-management" aria-label={t("settings.cloudDevices.title")}>
      <div className="cloud-device-management__header">
        <div>
          <strong>{t("settings.cloudDevices.title")}</strong>
          <p>{formatCloudDeviceSummary(access, devices, t)}</p>
        </div>
        <button
          type="button"
          className="settings-btn settings-btn--compact cloud-device-management__refresh"
          aria-label={refreshLabel}
          title={refreshLabel}
          onClick={() => void onRefresh()}
          disabled={isRefreshing}
        >
          <svg
            className={isRefreshing ? "cloud-device-management__refresh-icon is-spinning" : "cloud-device-management__refresh-icon"}
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
          >
            <path d="M20 11a8 8 0 0 0-14.9-4.2L3 9" />
            <path d="M3 4v5h5" />
            <path d="M4 13a8 8 0 0 0 14.9 4.2L21 15" />
            <path d="M21 20v-5h-5" />
          </svg>
        </button>
      </div>
      <div className="cloud-device-management__list">
        {devices.length > 0 ? devices.map((device) => (
          <div className="cloud-device-row" key={device.id}>
            <div className="cloud-device-row__copy">
              <span className="cloud-device-row__name">{device.label}</span>
              <span className="cloud-device-row__meta">
                {formatCloudDeviceLastSeen(device.lastSeenAt, effectiveLanguage, t)}
                {device.appVersion ? ` · ${device.appVersion}` : ""}
              </span>
            </div>
            {device.isCurrent ? (
              <span className="cloud-device-row__badge">{t("settings.cloudDevices.current")}</span>
            ) : (
              <button
                type="button"
                className="settings-btn settings-btn--compact cloud-device-row__remove"
                disabled={revokingId !== null}
                onClick={() => setPendingRemovalDevice(device)}
              >
                {revokingId === device.id ? t("settings.cloudDevices.removing") : t("settings.cloudDevices.remove")}
              </button>
            )}
          </div>
        )) : accessMessage ? (
          <p className="cloud-device-management__empty cloud-device-management__empty--error" role="status">{localizeSettingsError(accessMessage, effectiveLanguage, t)}</p>
        ) : (
          <p className="cloud-device-management__empty">{t("settings.cloudDevices.empty")}</p>
        )}
      </div>
      {actionError ? <p className="cloud-device-management__message" role="status">{localizeSettingsError(actionError, effectiveLanguage, t)}</p> : null}
      <ModalPresence
        onDismiss={() => setPendingRemovalDevice(null)}
        dismissDisabled={revokingId !== null}
      >
        {pendingRemovalDevice ? (
        <div
          className="cloud-device-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cloud-device-confirm-title"
          aria-describedby="cloud-device-confirm-description"
        >
          <div className="cloud-device-confirm__panel modal-shell" data-modal-variant="compact">
            <p className="cloud-device-confirm__eyebrow">{t("settings.cloudDevices.device")}</p>
            <h2 id="cloud-device-confirm-title">{t("settings.cloudDevices.removeTitle")}</h2>
            <p id="cloud-device-confirm-description">
              {t("settings.cloudDevices.removeDescription", { device: pendingRemovalDevice.label })}
            </p>
            <div className="cloud-device-confirm__device">
              <span>{pendingRemovalDevice.label}</span>
              <small>{formatCloudDeviceLastSeen(pendingRemovalDevice.lastSeenAt, effectiveLanguage, t)}</small>
            </div>
            <div className="cloud-device-confirm__actions">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setPendingRemovalDevice(null)}>
                {t("settings.cloudDevices.cancel")}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                disabled={revokingId !== null}
                onClick={confirmDeviceRemoval}
              >
                {t("settings.cloudDevices.removeDevice")}
              </button>
            </div>
          </div>
        </div>
        ) : null}
      </ModalPresence>
    </section>
  );
}

function formatCloudDeviceSummary(
  access: BillingEntitlement["deviceAccess"] | null,
  devices: readonly CloudDeviceRecord[],
  t: LocalizationController["t"],
): string {
  const activeCount = access?.activeDeviceCount ?? devices.filter((device) => device.isActive).length;
  const maxActiveDevices = access?.maxActiveDevices ?? 2;
  const activeWindowDays = access?.activeWindowDays ?? 30;
  return t("settings.cloudDevices.summary", { active: activeCount, max: maxActiveDevices, days: activeWindowDays });
}

function formatCloudDeviceLastSeen(value: string, language: "en" | "ko", t: LocalizationController["t"]): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("settings.cloudDevices.lastSeenUnknown");
  const formatted = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return t("settings.cloudDevices.lastSeen", { date: formatted });
}
