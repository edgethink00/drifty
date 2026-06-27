import { useState } from "react";

import type { BillingEntitlement } from "../billing/billingService";
import type { CloudDeviceRecord } from "./cloudDeviceService";
import "./CloudDeviceManagementPanel.css";

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
  const refreshLabel = isRefreshing ? "Refreshing Cloud devices" : "Refresh Cloud devices";
  const [pendingRemovalDevice, setPendingRemovalDevice] = useState<CloudDeviceRecord | null>(null);

  function confirmDeviceRemoval() {
    if (pendingRemovalDevice === null) return;
    const deviceId = pendingRemovalDevice.id;
    setPendingRemovalDevice(null);
    void onRevoke(deviceId);
  }

  return (
    <section className="cloud-device-management" aria-label="Cloud devices">
      <div className="cloud-device-management__header">
        <div>
          <strong>Cloud devices</strong>
          <p>{formatCloudDeviceSummary(access, devices)}</p>
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
                {formatCloudDeviceLastSeen(device.lastSeenAt)}
                {device.appVersion ? ` · ${device.appVersion}` : ""}
              </span>
            </div>
            {device.isCurrent ? (
              <span className="cloud-device-row__badge">Current</span>
            ) : (
              <button
                type="button"
                className="settings-btn settings-btn--compact cloud-device-row__remove"
                disabled={revokingId !== null}
                onClick={() => setPendingRemovalDevice(device)}
              >
                {revokingId === device.id ? "Removing..." : "Remove"}
              </button>
            )}
          </div>
        )) : (
          <p className="cloud-device-management__empty">Refresh devices to load active Macs for this account.</p>
        )}
      </div>
      {actionError ? <p className="cloud-device-management__message" role="status">{actionError}</p> : null}
      {pendingRemovalDevice ? (
        <div
          className="cloud-device-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cloud-device-confirm-title"
          aria-describedby="cloud-device-confirm-description"
        >
          <div className="cloud-device-confirm__panel">
            <p className="cloud-device-confirm__eyebrow">Cloud device</p>
            <h2 id="cloud-device-confirm-title">Remove this Mac?</h2>
            <p id="cloud-device-confirm-description">
              This removes {pendingRemovalDevice.label} from your active Drifty Cloud devices. Cloud AI will stop working on
              that Mac until it reconnects to this account.
            </p>
            <div className="cloud-device-confirm__device">
              <span>{pendingRemovalDevice.label}</span>
              <small>{formatCloudDeviceLastSeen(pendingRemovalDevice.lastSeenAt)}</small>
            </div>
            <div className="cloud-device-confirm__actions">
              <button type="button" className="settings-btn" onClick={() => setPendingRemovalDevice(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="settings-btn cloud-device-confirm__remove"
                disabled={revokingId !== null}
                onClick={confirmDeviceRemoval}
              >
                Remove device
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatCloudDeviceSummary(
  access: BillingEntitlement["deviceAccess"] | null,
  devices: readonly CloudDeviceRecord[],
): string {
  const activeCount = access?.activeDeviceCount ?? devices.filter((device) => device.isActive).length;
  const maxActiveDevices = access?.maxActiveDevices ?? 2;
  const activeWindowDays = access?.activeWindowDays ?? 30;
  return `${activeCount}/${maxActiveDevices} active Macs · active for ${activeWindowDays} days after Cloud use`;
}

function formatCloudDeviceLastSeen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last seen unknown";
  return `Last seen ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}
