import { useEffect, useMemo, useRef, useState } from "react";
import { KeyHint } from "../../components/KeyHint";

import type { BillingEntitlement } from "../billing/billingService";
import type { CloudDeviceRecord } from "./cloudDeviceService";
import "./CloudDeviceManagementPanel.css";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import { ModalPresence } from "../../components/ModalPresence";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { formatDeviceRelativeTime, type DeviceSyncSummary } from "../device-sync/deviceSyncSummary";
import type { DisplayLanguage } from "../localization/languagePreference";

export type CloudDeviceManagementPanelProps = {
  readonly access: BillingEntitlement["deviceAccess"] | null;
  readonly actionError: string | null;
  readonly devices: readonly CloudDeviceRecord[];
  readonly isRefreshing: boolean;
  readonly revokingId: string | null;
  /** This device's sync state; omitted where device sync is not offered. */
  readonly currentDeviceSync?: DeviceSyncSummary | null;
  /** Clock used for relative times; defaults to the time of render. */
  readonly now?: number;
  /** Settings gives the list its own block heading, so the panel drops its title and leads with the count. */
  readonly titled?: boolean;
  readonly onRefresh: () => void | Promise<unknown>;
  readonly onRevoke: (deviceId: string) => void | Promise<void>;
};

type RowTone = "ok" | "active" | "neutral" | "attention" | "error";

export function CloudDeviceManagementPanel({
  access,
  actionError,
  devices,
  isRefreshing,
  revokingId,
  currentDeviceSync = null,
  now,
  titled = true,
  onRefresh,
  onRevoke,
}: CloudDeviceManagementPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const refreshLabel = isRefreshing ? t("settings.cloudDevices.refreshingAria") : t("settings.cloudDevices.refreshAria");
  const [pendingRemovalDevice, setPendingRemovalDevice] = useState<CloudDeviceRecord | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const accessMessage = access && !access.allowed && access.message ? access.message : null;
  const orderedDevices = useMemo(() => orderDevices(devices), [devices]);
  const renderNow = now ?? Date.now();
  const windowDays = access?.activeWindowDays ?? 30;
  const count = (
    <span title={t("settings.cloudDevices.countHint", { days: windowDays })}>{formatCloudDeviceCount(access, devices, t)}</span>
  );

  function confirmDeviceRemoval() {
    if (pendingRemovalDevice === null) return;
    const deviceId = pendingRemovalDevice.id;
    setPendingRemovalDevice(null);
    void onRevoke(deviceId);
  }

  return (
    <section className="cloud-device-management" aria-label={t("settings.cloudDevices.yourDevices")}>
      <div className="cloud-device-management__header">
        <span className="cloud-device-management__title">{titled ? t("settings.cloudDevices.yourDevices") : count}</span>
        <span className="cloud-device-management__summary">
          {titled ? count : null}
          <button
            type="button"
            className="cloud-device-management__refresh"
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
        </span>
      </div>
      {orderedDevices.length > 0 ? (
        <ul className="cloud-device-list">
          {orderedDevices.map((device) => {
            const status = deviceStatus(device, currentDeviceSync, revokingId, t);
            return (
              <li className={device.isActive || device.isCurrent ? "cloud-device-row" : "cloud-device-row is-inactive"} key={device.id}>
                <span className="cloud-device-row__icon" aria-hidden="true">{device.platform === "windows" ? DESKTOP_ICON : LAPTOP_ICON}</span>
                <span className="cloud-device-row__copy">
                  <span className="cloud-device-row__name" title={device.label}>{device.label}</span>
                  <span className="cloud-device-row__meta">{deviceMeta(device, renderNow, effectiveLanguage, t)}</span>
                </span>
                <span className={"cloud-device-row__status cloud-device-row__status--" + status.tone}>
                  <span className="cloud-device-row__dot" aria-hidden="true" />
                  {status.label}
                </span>
                {device.isCurrent ? (
                  <span className="cloud-device-row__menu-slot" aria-hidden="true" />
                ) : (
                  <CloudDeviceRowMenu
                    device={device}
                    open={openMenuId === device.id}
                    disabled={revokingId !== null}
                    onOpenChange={(open) => setOpenMenuId(open ? device.id : null)}
                    onRemove={() => setPendingRemovalDevice(device)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : accessMessage ? (
        <p className="cloud-device-management__empty cloud-device-management__empty--error" role="status">{localizeSettingsError(accessMessage, effectiveLanguage, t)}</p>
      ) : (
        <p className="cloud-device-management__empty">{t("settings.cloudDevices.empty")}</p>
      )}
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
                <KeyHint shortcut="escape" />
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

function CloudDeviceRowMenu({
  device,
  open,
  disabled,
  onOpenChange,
  onRemove,
}: {
  readonly device: CloudDeviceRecord;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useLocalization();
  const slot = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && slot.current?.contains(event.target)) return;
      onOpenChangeRef.current(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChangeRef.current(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) onOpenChangeRef.current(false);
  }, [disabled, open]);

  return (
    <span className="cloud-device-row__menu-slot" ref={slot}>
      <button
        ref={trigger}
        type="button"
        className="cloud-device-row__more"
        aria-label={t("settings.cloudDevices.optionsAria", { device: device.label })}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.6" cy="12" r="1.7" /></svg>
      </button>
      <AnchoredPresence>{open ? (
        <div className="cloud-device-row__menu" role="menu" aria-label={t("settings.cloudDevices.optionsAria", { device: device.label })}>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={disabled}
            onClick={() => {
              // The menu closes with the choice, so focus returns to its persistent trigger.
              trigger.current?.focus({ preventScroll: true });
              onOpenChange(false);
              onRemove();
            }}
          >
            {t("settings.cloudDevices.removeFromAccount")}
          </button>
        </div>
      ) : null}</AnchoredPresence>
    </span>
  );
}

const LAPTOP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
    <rect x="4" y="5" width="16" height="11" rx="1.6" />
    <path d="M2 19h20" />
  </svg>
);

const DESKTOP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
    <rect x="3" y="4" width="18" height="12" rx="1.6" />
    <path d="M9 20h6M12 16v4" />
  </svg>
);

/**
 * The device list as it looks once sync is on, shown dimmed while this device
 * is not syncing. It states only what is true now: this computer's platform
 * and app version, with sync off, and where the other computers will appear.
 */
export function CloudDevicePreviewPanel({ platform, appVersion }: {
  readonly platform: "macos" | "windows";
  readonly appVersion: string | null;
}) {
  const { t } = useLocalization();
  const meta = [platformLabel(platform), appVersion ? "v" + appVersion : null].filter(Boolean).join(" · ");
  return (
    <section className="cloud-device-management cloud-device-management--preview" aria-label={t("settings.cloudDevices.yourDevices")}>
      <ul className="cloud-device-list">
        <li className="cloud-device-row">
          <span className="cloud-device-row__icon" aria-hidden="true">{platform === "windows" ? DESKTOP_ICON : LAPTOP_ICON}</span>
          <span className="cloud-device-row__copy">
            <span className="cloud-device-row__name">{t("settings.cloudDevices.previewThisComputer")}</span>
            <span className="cloud-device-row__meta">{meta}</span>
          </span>
          <span className="cloud-device-row__status cloud-device-row__status--neutral">
            <span className="cloud-device-row__dot" aria-hidden="true" />
            {t("settings.cloudDevices.statusSyncOff")}
          </span>
          <span className="cloud-device-row__menu-slot" aria-hidden="true" />
        </li>
        <li className="cloud-device-row cloud-device-row--placeholder">
          <span className="cloud-device-row__icon" aria-hidden="true">{platform === "windows" ? LAPTOP_ICON : DESKTOP_ICON}</span>
          <span className="cloud-device-row__copy">
            <span className="cloud-device-row__meta">{t("settings.cloudDevices.previewOthers")}</span>
          </span>
        </li>
      </ul>
    </section>
  );
}

/** This device first, then devices that still count toward the limit, most recent first. */
function orderDevices(devices: readonly CloudDeviceRecord[]): CloudDeviceRecord[] {
  const rank = (device: CloudDeviceRecord) => (device.isCurrent ? 0 : device.isActive ? 1 : 2);
  return [...devices].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    return timestampOf(right.lastSeenAt) - timestampOf(left.lastSeenAt);
  });
}

function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deviceStatus(
  device: CloudDeviceRecord,
  currentDeviceSync: DeviceSyncSummary | null,
  revokingId: string | null,
  t: LocalizationController["t"],
): { readonly label: string; readonly tone: RowTone } {
  if (revokingId === device.id) return { label: t("settings.cloudDevices.removing"), tone: "neutral" };
  if (device.isCurrent && currentDeviceSync) {
    switch (currentDeviceSync.kind) {
      case "off": return { label: t("settings.cloudDevices.statusSyncOff"), tone: "neutral" };
      case "limit": return { label: t("settings.cloudDevices.statusLimit"), tone: "attention" };
      case "paused": return { label: t("settings.cloudDevices.statusPaused"), tone: "attention" };
      case "error": return { label: t("settings.cloudDevices.statusError"), tone: "error" };
      default: return { label: t("settings.cloudDevices.statusSyncOn"), tone: "ok" };
    }
  }
  if (device.isCurrent || device.isActive) return { label: t("settings.cloudDevices.statusInUse"), tone: "active" };
  return { label: t("settings.cloudDevices.statusInactive"), tone: "neutral" };
}

function deviceMeta(device: CloudDeviceRecord, now: number, language: DisplayLanguage, t: LocalizationController["t"]): string {
  const parts: string[] = [];
  if (device.isCurrent) parts.push(t("settings.cloudDevices.thisDevice"));
  const platform = platformLabel(device.platform);
  if (platform) parts.push(platform);
  if (!device.isCurrent) {
    const lastUsed = formatDeviceRelativeTime(device.lastSeenAt, now, language);
    if (lastUsed) parts.push(t("settings.cloudDevices.lastUsed", { time: lastUsed }));
  }
  if (device.appVersion) parts.push("v" + device.appVersion.replace(/^v/i, ""));
  return parts.join(" · ");
}

function platformLabel(platform: string): string | null {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  return null;
}

function formatCloudDeviceCount(
  access: BillingEntitlement["deviceAccess"] | null,
  devices: readonly CloudDeviceRecord[],
  t: LocalizationController["t"],
): string {
  const activeCount = access?.activeDeviceCount ?? devices.filter((device) => device.isActive).length;
  const maxActiveDevices = access?.maxActiveDevices ?? 3;
  return t("settings.cloudDevices.inUseCount", { active: activeCount, max: maxActiveDevices });
}

export function formatCloudDeviceLastSeen(value: string, language: "en" | "ko", t: LocalizationController["t"]): string {
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

