import { useEffect, useState, type ReactNode } from "react";

import { Toggle } from "../../components/Toggle";
import { ActionLabel } from "../../components/ActionLabel";
import type { BillingEntitlement } from "../billing/billingService";
import { CloudDeviceManagementPanel, CloudDevicePreviewPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import { DeviceSyncSetupModal, type DeviceSyncEarlierRecords } from "../device-sync/DeviceSyncSetupModal";
import { formatDeviceRelativeTime, resolveDeviceSyncSummary, type DeviceSyncSummary } from "../device-sync/deviceSyncSummary";
import type { DeviceSyncEnableOptions, DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import "./DevicesSettingsBlock.css";

/** One inline action that would let a switched-off device turn sync on. */
export type DeviceSyncAccessAction = {
  readonly label: string;
  readonly onClick: () => void;
};

/** What this computer can truthfully show in the dimmed preview before it syncs. */
export type DeviceSyncPreviewDevice = {
  readonly platform: "macos" | "windows";
  readonly appVersion: string | null;
};

export type DevicesSettingsBlockProps = {
  readonly isSignedIn: boolean;
  readonly deviceLimitReached: boolean;
  readonly showDeviceList: boolean;
  readonly cloudDeviceAccess: BillingEntitlement["deviceAccess"] | null;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: BillingEntitlement["cloudDevices"];
  readonly cloudStatusRefreshing: boolean;
  readonly deviceSyncEnabled: boolean;
  readonly deviceSyncCanEnable: boolean;
  readonly deviceSyncGateActive: boolean;
  readonly deviceSyncStatus?: DeviceSyncStatus;
  readonly deviceSyncPurging: boolean;
  readonly deviceSyncStoppedFromPhone?: boolean;
  /** This device synced with another account before; turning on asks whether those records come along. */
  readonly deviceSyncEarlierRecords?: DeviceSyncEarlierRecords | null;
  readonly accessAction?: DeviceSyncAccessAction | null;
  /** Shown dimmed in place of the device list while sync is off and no list is available. */
  readonly previewDevice?: DeviceSyncPreviewDevice | null;
  /** Present only where device sync is offered. */
  readonly onDeviceSyncEnabledChange?: (enabled: boolean, options?: DeviceSyncEnableOptions) => void;
  readonly onDeviceSyncNow?: () => void | Promise<void>;
  readonly onPurgeDeviceSyncData?: () => void | Promise<void>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
};

const RELATIVE_TIME_TICK_MS = 30_000;

/**
 * Settings > Sync, as two blocks: this device's sync switch with the cloud
 * copy at its foot, then the account's device list (dimmed as a preview while
 * this device is not syncing and no list is available).
 */
export function DevicesSettingsBlock({
  isSignedIn,
  deviceLimitReached,
  showDeviceList,
  cloudDeviceAccess,
  cloudDeviceActionError,
  cloudDeviceRevokingId,
  cloudDevices,
  cloudStatusRefreshing,
  deviceSyncEnabled,
  deviceSyncCanEnable,
  deviceSyncGateActive,
  deviceSyncStatus,
  deviceSyncPurging,
  deviceSyncStoppedFromPhone = false,
  deviceSyncEarlierRecords = null,
  accessAction = null,
  previewDevice = null,
  onDeviceSyncEnabledChange,
  onDeviceSyncNow,
  onPurgeDeviceSyncData,
  onRefreshCloudStatus,
  onRevokeCloudDevice,
}: DevicesSettingsBlockProps) {
  const { t } = useLocalization();
  const [syncSetupMode, setSyncSetupMode] = useState<"info" | "enable" | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const syncOffered = Boolean(onDeviceSyncEnabledChange);
  const summary = syncOffered
    ? resolveDeviceSyncSummary({
      enabled: deviceSyncEnabled,
      gateActive: deviceSyncGateActive,
      deviceLimitReached,
      running: syncRunning,
      status: deviceSyncStatus,
    })
    : null;
  const canSyncNow = Boolean(onDeviceSyncNow) && deviceSyncGateActive && !syncRunning;
  const showPreview = syncOffered && !showDeviceList && !deviceSyncEnabled && previewDevice !== null;

  if (!syncOffered && !showDeviceList) return null;

  async function syncNow() {
    if (!onDeviceSyncNow || !canSyncNow) return;
    setSyncRunning(true);
    try {
      await onDeviceSyncNow();
    } catch (error) {
      // The sync controller records failures in its status; this only ends the busy state.
      console.warn("device sync from Settings failed", error);
    } finally {
      setSyncRunning(false);
    }
  }

  return (
    <>
    {syncOffered ? (
    <div data-setting-id="settings.section.sync" className="settings-block settings-block--sync">
      <h3>{t("settings.section.sync")}</h3>
      {summary && onDeviceSyncEnabledChange ? (
        <div data-setting-id="settings.account.syncMacs" className="settings-row account-device-sync-row">
          <div className="account-device-sync-row__copy">
            <div className="lbl settings-label-with-badge">
              {t("settings.account.syncThisDevice")}
              <span className="status-badge">Pro</span>
            </div>
            <DeviceSyncStatusLine
              summary={summary}
              now={now}
              errorMessage={deviceSyncStatus?.lastError ?? null}
              canSyncNow={canSyncNow}
              accessAction={accessAction}
              stoppedFromPhone={deviceSyncStoppedFromPhone}
              onSyncNow={() => void syncNow()}
              onLearnMore={() => setSyncSetupMode("info")}
            />
          </div>
          <div className="ctrl">
            <Toggle
              checked={deviceSyncEnabled}
              disabled={!deviceSyncEnabled && !deviceSyncCanEnable}
              onChange={(enabled) => {
                if (enabled) setSyncSetupMode("enable");
                else onDeviceSyncEnabledChange(false);
              }}
              ariaLabel={t("settings.account.toggleSync")}
            />
          </div>
        </div>
      ) : null}
      {isSignedIn ? (
        <div className="settings-row account-cloud-copy-row">
          <span className="account-cloud-copy-row__note">{t("settings.account.cloudCopyRetention")}</span>
          <button
            type="button"
            className="account-cloud-copy-row__delete"
            onClick={() => void onPurgeDeviceSyncData?.()}
            disabled={!onPurgeDeviceSyncData || deviceSyncPurging}
            aria-busy={deviceSyncPurging}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" /></svg>
            <ActionLabel busy={deviceSyncPurging} busyLabel={t("settings.account.deleting")}>{t("settings.account.deleteCloudEllipsis")}</ActionLabel>
          </button>
        </div>
      ) : null}
      {onDeviceSyncEnabledChange ? (
        <DeviceSyncSetupModal mode={syncSetupMode} canEnable={deviceSyncCanEnable}
          earlierRecords={deviceSyncEarlierRecords}
          onClose={() => setSyncSetupMode(null)} onEnable={(options) => {
            if (!deviceSyncCanEnable) return;
            setSyncSetupMode(null);
            onDeviceSyncEnabledChange(true, options);
          }} />
      ) : null}
    </div>
    ) : null}
    {showDeviceList || (showPreview && previewDevice) ? (
      <div data-setting-id="settings.cloudDevices.yourDevices" className="settings-block settings-block--devices">
        <h3>{t("settings.cloudDevices.yourDevices")}</h3>
        {showDeviceList ? (
          <div className="settings-row settings-row--cloud-devices">
            <CloudDeviceManagementPanel
              access={cloudDeviceAccess}
              actionError={cloudDeviceActionError}
              devices={cloudDevices ?? []}
              isRefreshing={cloudStatusRefreshing}
              revokingId={cloudDeviceRevokingId}
              currentDeviceSync={summary}
              now={now}
              titled={false}
              onRefresh={onRefreshCloudStatus}
              onRevoke={onRevokeCloudDevice}
            />
          </div>
        ) : previewDevice ? (
          <div className="settings-row settings-row--cloud-devices device-sync-preview" aria-disabled="true">
            <CloudDevicePreviewPanel platform={previewDevice.platform} appVersion={previewDevice.appVersion} />
          </div>
        ) : null}
      </div>
    ) : null}
    </>
  );
}

function DeviceSyncStatusLine({
  summary,
  now,
  errorMessage,
  canSyncNow,
  accessAction,
  stoppedFromPhone,
  onSyncNow,
  onLearnMore,
}: {
  readonly summary: DeviceSyncSummary;
  readonly now: number;
  readonly errorMessage: string | null;
  readonly canSyncNow: boolean;
  readonly accessAction: DeviceSyncAccessAction | null;
  readonly stoppedFromPhone: boolean;
  readonly onSyncNow: () => void;
  readonly onLearnMore: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const learnMore = (
    <button type="button" className="account-device-sync-link" aria-haspopup="dialog" onClick={onLearnMore}>
      {t("settings.account.syncLearnMore")}
    </button>
  );
  const syncNowLink = (label: string) => (
    <button type="button" className="account-device-sync-link" onClick={onSyncNow} disabled={!canSyncNow}>
      {label}
    </button>
  );
  const separator = <span className="account-device-sync-status__separator" aria-hidden="true">·</span>;

  if (summary.kind === "off") {
    return (
      <div className="desc">
        {stoppedFromPhone ? t("settings.account.syncStoppedFromPhone") : t("settings.account.syncDescription")}{" "}{learnMore}
        {accessAction ? (
          <>
            {separator}
            <button type="button" className="account-device-sync-link" onClick={accessAction.onClick}>{accessAction.label}</button>
          </>
        ) : null}
      </div>
    );
  }

  const tone = summary.tone;
  const announce = tone === "attention" || tone === "error";
  let content: ReactNode;
  switch (summary.kind) {
    case "limit":
      content = <>{t("settings.account.syncLimitReached")}</>;
      break;
    case "paused":
      content = <>{t("settings.account.syncPaused")}</>;
      break;
    case "running":
      content = <>{t("settings.account.syncRunning")}</>;
      break;
    case "error":
      content = (
        <>
          <span>{errorMessage
            ? t("settings.account.syncFailedWithDetail", { detail: localizeSettingsError(errorMessage, effectiveLanguage, t) })
            : t("settings.cloudDevices.statusError")}</span>
          {syncNowLink(t("settings.account.syncTryAgain"))}
        </>
      );
      break;
    case "uploading":
      content = <>{t("settings.account.syncUploadingThisDevice", { percent: summary.percent ?? 0 })}</>;
      break;
    case "synced": {
      const time = summary.lastSyncedAt ? formatDeviceRelativeTime(summary.lastSyncedAt, now, effectiveLanguage) : null;
      content = (
        <>
          <span>{time ? t("settings.account.syncedAgo", { time }) : t("settings.account.syncWaiting")}</span>
          {separator}
          {syncNowLink(t("settings.account.syncNow"))}
          {separator}
          {learnMore}
        </>
      );
      break;
    }
    default:
      content = (
        <>
          <span>{t("settings.account.syncWaiting")}</span>
          {separator}
          {syncNowLink(t("settings.account.syncNow"))}
        </>
      );
  }

  return (
    <div className={"account-device-sync-status account-device-sync-status--" + tone} role={announce ? "status" : undefined}>
      <div className="account-device-sync-status__line">
        <span className="account-device-sync-status__dot" aria-hidden="true" />
        {content}
      </div>
      {summary.kind === "uploading" ? (
        <div
          className="account-device-sync-status__progress"
          role="progressbar"
          aria-label={t("settings.account.syncUploadingThisDevice", { percent: summary.percent ?? 0 })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.percent ?? 0}
        >
          <span style={{ width: String(summary.percent ?? 0) + "%" }} />
        </div>
      ) : null}
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
