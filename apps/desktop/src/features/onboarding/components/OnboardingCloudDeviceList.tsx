import { useState } from "react";

import type { CloudDeviceRecord } from "../../cloud-devices/cloudDeviceService";
import { formatCloudDeviceLastSeen } from "../../cloud-devices/CloudDeviceManagementPanel";
import { useLocalization } from "../../localization/LocalizationContext";
import { localizeSettingsError } from "../../localization/settingsMessageTranslations";
import { ActionLabel } from "../../../components/ActionLabel";

/**
 * The account's other Cloud devices, shown on the final setup step when this
 * computer cannot join because the device limit is full. Settings > Account
 * has the same list, but a first-run user cannot reach it before finishing
 * setup, and often has no other computer to open it on.
 */
export function OnboardingCloudDeviceList({
  devices,
  revokingId,
  actionError,
  disabled,
  onRevoke,
}: {
  readonly devices: readonly CloudDeviceRecord[];
  readonly revokingId: string | null;
  readonly actionError: string | null;
  readonly disabled: boolean;
  readonly onRevoke: (deviceId: string) => Promise<void>;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const removable = devices.filter((device) => !device.isCurrent);
  if (removable.length === 0) return null;

  return (
    <div className="dc-onb-devices">
      <ul className="dc-onb-devices__list" aria-label={t("settings.cloudDevices.title")}>
        {removable.map((device) => {
          const confirming = confirmingId === device.id;
          const removing = revokingId === device.id;
          return (
            <li className="dc-onb-devices__row" key={device.id}>
              <span className="dc-onb-devices__copy">
                <strong>{device.label}</strong>
                <small>
                  {confirming
                    ? t("settings.cloudDevices.removeDescription", { device: device.label })
                    : `${formatCloudDeviceLastSeen(device.lastSeenAt, effectiveLanguage, t)}${device.appVersion ? ` · ${device.appVersion}` : ""}`}
                </small>
              </span>
              {confirming ? (
                <span className="dc-onb-devices__actions">
                  <button type="button" className="dc-onb-devices__button" disabled={removing} onClick={() => setConfirmingId(null)}>
                    {t("settings.cloudDevices.cancel")}
                  </button>
                  <button
                    type="button"
                    className="dc-onb-devices__button dc-onb-devices__button--danger"
                    disabled={disabled || revokingId !== null}
                    onClick={() => {
                      void onRevoke(device.id).finally(() => setConfirmingId(null));
                    }}
                  >
                    <ActionLabel busy={removing} busyLabel={t("settings.cloudDevices.removing")}>{t("settings.cloudDevices.removeDevice")}</ActionLabel>
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="dc-onb-devices__button"
                  aria-label={`${t("settings.cloudDevices.remove")}: ${device.label}`}
                  disabled={disabled || revokingId !== null}
                  onClick={() => setConfirmingId(device.id)}
                >
                  {t("settings.cloudDevices.remove")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {actionError ? (
        <p className="dc-onb-devices__error" role="alert">{localizeSettingsError(actionError, effectiveLanguage, t)}</p>
      ) : null}
    </div>
  );
}
