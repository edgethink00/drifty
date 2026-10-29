// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncSettingsSection, type SyncSettingsSectionProps } from "./SyncSettingsSection";
import type { BillingEntitlement } from "../billing/billingService";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

function desktopSourcePath(relativePath: string): string {
  const rootPath = join(process.cwd(), "apps/desktop", relativePath);
  return existsSync(rootPath) ? rootPath : join(process.cwd(), relativePath);
}

const individualEntitlement = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
} as const satisfies BillingEntitlement;

const lockedEntitlement = (lockedReason: NonNullable<BillingEntitlement["lockedReason"]>, overrides: Partial<BillingEntitlement> = {}): BillingEntitlement => ({
  ...individualEntitlement, status: "locked", canUseApp: false, lockedReason, ...overrides,
});

function devicesProps(overrides: Partial<SyncSettingsSectionProps> = {}): SyncSettingsSectionProps {
  return {
    billingEntitlement: individualEntitlement,
    billingEntitlementError: null,
    cloudDeviceAccess: null,
    cloudDeviceActionError: null,
    cloudDeviceRevokingId: null,
    cloudDevices: [],
    cloudStatusRefreshing: false,
    hasSignedInAccount: true,
    isSupabaseConfigured: true,
    userEmail: "alex@example.com",
    onDeviceSyncEnabledChange: vi.fn(),
    onRefreshCloudStatus: vi.fn(),
    onRevokeCloudDevice: vi.fn(),
    onSignIn: vi.fn(),
    onUpgradeToPro: vi.fn(),
    ...overrides,
  };
}

describe("SyncSettingsSection", () => {
  it("follows the device blocks with the iPhone section and its QR code once the app is out", () => {
    // Outside the EU storefronts, where the App Store offers the app.
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: "Asia/Seoul" };
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, 12));
    try {
      const { container } = render(<SyncSettingsSection {...devicesProps()} />);
      const blocks = Array.from(container.querySelectorAll(".settings-block")).map((block) => block.getAttribute("data-setting-id"));
      expect(blocks.slice(-2)).toEqual(["settings.cloudDevices.yourDevices", "settings.phoneApp.section"]);
      expect(container.querySelector('[data-setting-id="settings.phoneApp.section"] .phone-app-settings__qr')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("shows active Cloud devices and confirms before removing a non-current device", async () => {
    const onRevokeCloudDevice = vi.fn();
    const onRefreshCloudStatus = vi.fn();

    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("device_limit_reached"),
      cloudDeviceAccess: {
        allowed: false,
        reason: "device_limit_reached",
        message: "This Drifty Pro plan is already active on 2 desktop devices.",
        activeDeviceCount: 2,
        maxActiveDevices: 2,
        activeWindowDays: 30,
        deviceId: null,
      },
      cloudDevices: [
        {
          id: "device-current",
          label: "Current Mac",
          platform: "macos",
          appVersion: "0.9.0",
          firstSeenAt: "2026-06-01T00:00:00.000Z",
          lastSeenAt: "2026-06-26T00:00:00.000Z",
          revokedAt: null,
          isCurrent: true,
          isActive: true,
        },
        {
          id: "device-old",
          label: "Old MacBook",
          platform: "macos",
          appVersion: "0.9.0",
          firstSeenAt: "2026-06-01T00:00:00.000Z",
          lastSeenAt: "2026-06-25T00:00:00.000Z",
          revokedAt: null,
          isCurrent: false,
          isActive: true,
        },
      ],
      onRefreshCloudStatus,
      onRevokeCloudDevice,
    })} />);

    const cloudDevices = screen.getByRole("region", { name: /^Your devices$/i });
    const devicesBlock = screen.getByRole("heading", { name: /^Your devices$/i }).closest(".settings-block");
    expect(devicesBlock?.contains(cloudDevices)).toBe(true);
    expect(within(cloudDevices).getByText("2 of 2 in use")).toBeTruthy();
    expect(within(cloudDevices).getByText("Current Mac")).toBeTruthy();
    expect(within(cloudDevices).getByText("This device · macOS · v0.9.0")).toBeTruthy();
    expect(within(cloudDevices).queryByRole("button", { name: "Options for Current Mac" })).toBeNull();

    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Refresh devices$/i }));
    expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1);

    const requestRemoval = () => {
      fireEvent.click(within(cloudDevices).getByRole("button", { name: "Options for Old MacBook" }));
      fireEvent.click(within(cloudDevices).getByRole("menuitem", { name: "Remove from account…" }));
    };
    requestRemoval();
    expect(onRevokeCloudDevice).not.toHaveBeenCalled();

    const cancelDialog = screen.getByRole("alertdialog", { name: /^Remove this device\?$/i });
    expect(within(cancelDialog).getAllByText(/Old MacBook/).length).toBeGreaterThan(0);
    expect(within(cancelDialog).getByText(/Cloud AI and device sync stop on that device/)).toBeTruthy();

    await waitFor(() => expect(cancelDialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(cancelDialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.getByRole("alertdialog", { name: /^Remove this device\?$/i })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: /^Remove this device\?$/i })).toBeNull());

    requestRemoval();

    const confirmDialog = screen.getByRole("alertdialog", { name: /^Remove this device\?$/i });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /^Remove device$/i }));

    expect(onRevokeCloudDevice).toHaveBeenCalledWith("device-old");
  });

  it("surfaces Cloud device access failures instead of presenting an empty device list", () => {
    render(<SyncSettingsSection {...devicesProps({
      cloudDeviceAccess: {
        allowed: false,
        reason: "unavailable",
        message: "Drifty Cloud device access is unavailable.",
        activeDeviceCount: null,
        maxActiveDevices: 2,
        activeWindowDays: 30,
        deviceId: null,
      },
    })} />);

    const cloudDevices = screen.getByRole("region", { name: /^Your devices$/i });
    expect(within(cloudDevices).getByText("Drifty Cloud device access is unavailable.")).toBeTruthy();
    expect(within(cloudDevices).queryByText(/Refresh devices to load active desktop devices/i)).toBeNull();
  });

  it("keeps device list controls quiet and the removal dialog above Settings", () => {
    const styles = readFileSync(desktopSourcePath("src/features/cloud-devices/CloudDeviceManagementPanel.css"), "utf8");
    const confirmOverlayRule = cssRule(styles, ".cloud-device-confirm");

    expect(cssRule(styles, ".cloud-device-management__refresh")).toContain("border-radius: var(--radius-pill);");
    expect(cssRule(styles, ".cloud-device-row__more")).toContain("border-radius: var(--radius-pill);");
    expect(cssRule(styles, ".cloud-device-row__menu button.danger")).toContain("color: var(--warn);");
    expect(styles).not.toContain(".cloud-device-row__remove");
    expect(confirmOverlayRule).toContain("position: fixed;");
    expect(confirmOverlayRule).toContain("z-index: var(--z-settings-popover);");
    // The confirm's danger button uses the shared modal-btn--danger chrome
    // (styles/modal-chrome.css), so this stylesheet carries no per-button rule.
    expect(styles).not.toContain(".cloud-device-confirm__remove");
    const devicesStyles = readFileSync(desktopSourcePath("src/features/settings/DevicesSettingsBlock.css"), "utf8");
    // The cloud copy row sits under the shared inset divider; a full-width rule
    // of its own drew a second line across the card (2026-10-29).
    expect(devicesStyles).not.toMatch(/settings-block--sync > \.settings-row \+ \.settings-row/);
  });

  it("explains uploads when enabling and keeps sync off until confirmed", () => {
    const onDeviceSyncEnabledChange = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncCanEnable: true, onDeviceSyncEnabledChange,
    })} />);

    const toggle = screen.getByRole("switch", { name: "Toggle device sync" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/Projects, classification rules/)).toBeNull();
    fireEvent.click(toggle);
    const dialog = screen.getByRole("dialog", { name: "Turn on device sync?" });
    expect(within(dialog).getByText(/apps, window titles and sites/)).toBeTruthy();
    expect(onDeviceSyncEnabledChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on sync" }));
    expect(onDeviceSyncEnabledChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("cancels enablement and lets users read details without opting in", async () => {
    const onDeviceSyncEnabledChange = vi.fn();
    render(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: true, onDeviceSyncEnabledChange })} />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle device sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));
    const dialog = screen.getByRole("dialog", { name: "Device sync" });
    expect(within(dialog).queryByRole("button", { name: "Turn on sync" })).toBeNull();
    expect(within(dialog).getByText(/every 3 minutes while Drifty is running/)).toBeTruthy();
    expect(onDeviceSyncEnabledChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cannot confirm enablement if access expires while the dialog is open", () => {
    const onDeviceSyncEnabledChange = vi.fn();
    const { rerender } = render(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: true, onDeviceSyncEnabledChange })} />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle device sync" }));
    rerender(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: false, onDeviceSyncEnabledChange })} />);
    const confirm = screen.getByRole("button", { name: "Turn on sync" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onDeviceSyncEnabledChange).not.toHaveBeenCalled();
  });

  it("blocks new opt-in without access while keeping owner cloud deletion available", () => {
    const onDeviceSyncEnabledChange = vi.fn();
    const onPurgeDeviceSyncData = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncCanEnable: false, onDeviceSyncEnabledChange, onPurgeDeviceSyncData,
      billingEntitlement: lockedEntitlement("billing_missing"),
    })} />);

    const toggle = screen.getByRole("switch", { name: "Toggle device sync" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onDeviceSyncEnabledChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Delete cloud copy…$/i }));
    expect(onPurgeDeviceSyncData).toHaveBeenCalledOnce();
  });

  it("lets an opted-in user switch sync off after access is lost", () => {
    const onDeviceSyncEnabledChange = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: true, deviceSyncCanEnable: false, onDeviceSyncEnabledChange,
    })} />);

    const toggle = screen.getByRole("switch", { name: "Toggle device sync" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle);
    expect(onDeviceSyncEnabledChange).toHaveBeenCalledWith(false);
  });

  it("says the iPhone turned sync off and still lets the person turn it on here", () => {
    const onDeviceSyncEnabledChange = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: false, deviceSyncCanEnable: true, deviceSyncStoppedFromPhone: true, onDeviceSyncEnabledChange,
    })} />);

    expect(screen.getByText(/Sync was turned off from your iPhone\./)).toBeTruthy();
    expect(screen.queryByText(/See activity from your devices in one place\./)).toBeNull();
    const toggle = screen.getByRole("switch", { name: "Toggle device sync" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([0, 1])("reports upload work from the outbox rather than sequence gaps (pending %s)", (pendingPushCount) => {
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: true,
      deviceSyncGateActive: true,
      deviceSyncStatus: {
        enabled: true, deviceId: "device-current", pendingPushCount,
        backfill: { pushedSeq: 5, totalSeq: 10 },
        lastPushedAt: "2026-10-03T16:00:00Z", lastPulledAt: "2026-10-03T16:01:00Z",
        lastError: null, lastErrorCode: null, lastErrorHttpStatus: null, lastErrorLockedReason: null,
      },
    })} />);
    expect(Boolean(screen.queryByText("Uploading this device’s history · 50%"))).toBe(pendingPushCount > 0);
    expect(Boolean(screen.queryByText(/^Synced /))).toBe(pendingPushCount === 0);
  });

  it("keeps owner cloud deletion available when device sync is off or Pro access has expired", () => {
    const onPurgeDeviceSyncData = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("billing_missing"),
      deviceSyncEnabled: false,
      onPurgeDeviceSyncData,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));
    expect(screen.getByText(/cloud copy is deleted after 60 days unless access returns/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Cloud copy is kept for 60 days after Pro access ends.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Delete cloud copy…$/i }));
    expect(onPurgeDeviceSyncData).toHaveBeenCalledTimes(1);
  });
});

describe("SyncSettingsSection access action", () => {
  const actionsOf = () => Array.from(document.querySelectorAll('[data-setting-id="settings.account.syncMacs"] .desc button'))
    .map((button) => button.textContent);

  it("offers sign-in when signed out, since Account's sign-in is a section away", () => {
    const onSignIn = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: null, hasSignedInAccount: false, userEmail: null, deviceSyncCanEnable: false, onSignIn,
    })} />);

    expect(actionsOf()).toEqual(["Learn more", "Sign in"]);
    expect((screen.getByRole("switch", { name: "Toggle device sync" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("offers Pro to a signed-in account without access, and the trial where one is available", () => {
    const onUpgradeToPro = vi.fn();
    const { rerender } = render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("trial_expired"), deviceSyncCanEnable: false, onUpgradeToPro,
    })} />);
    expect(actionsOf()).toEqual(["Learn more", "Upgrade to Pro"]);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(onUpgradeToPro).toHaveBeenCalledOnce();

    rerender(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("billing_missing", { trialActivation: { state: "available", startedAt: null, endsAt: null } }),
      deviceSyncCanEnable: false, onUpgradeToPro,
    })} />);
    expect(actionsOf()).toEqual(["Learn more", "Start 7-day free trial"]);
  });

  it.each([
    ["payment recovery", { billingEntitlement: lockedEntitlement("payment_required") }],
    ["an organization seat", { billingEntitlement: lockedEntitlement("billing_missing", { entitlementOwner: "organization" }) }],
    ["an unverified plan", { billingEntitlement: lockedEntitlement("billing_missing"), cloudStatusRefreshing: true }],
    ["a failed plan check", { billingEntitlement: lockedEntitlement("billing_missing"), billingEntitlementError: "Plan check unavailable." }],
    ["a signed-out build without Drifty Cloud", { billingEntitlement: null, hasSignedInAccount: false, userEmail: null, isSupabaseConfigured: false }],
    ["access that is present", { deviceSyncCanEnable: true }],
    ["sync that is already on", { billingEntitlement: lockedEntitlement("trial_expired"), deviceSyncEnabled: true }],
  ] as const)("adds no access action for %s", (_label, overrides) => {
    render(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: false, ...overrides })} />);
    expect(actionsOf().filter((label) => label !== "Learn more" && label !== "Sync now")).toEqual([]);
  });
});

describe("SyncSettingsSection list preview", () => {
  const preview = () => document.querySelector<HTMLElement>(".device-sync-preview");

  it("shows this computer dimmed and inert while it is not syncing, with the action still live", () => {
    const onSignIn = vi.fn();
    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: null, hasSignedInAccount: false, userEmail: null, deviceSyncCanEnable: false,
      hostPlatform: "macos", appVersion: "1.12.5", onSignIn,
    })} />);

    const panel = preview()!;
    expect(panel.getAttribute("aria-disabled")).toBe("true");
    expect(within(panel).getByRole("region", { name: "Your devices" })).toBeTruthy();
    // The heading names the block at full strength; only the card below it is dimmed, with no limit line.
    const heading = screen.getByRole("heading", { name: "Your devices" });
    expect(panel.contains(heading)).toBe(false);
    expect(heading.closest(".settings-block")?.contains(panel)).toBe(true);
    expect(screen.queryByText(/Up to 3|computers$/)).toBeNull();
    expect(within(panel).getByText("This computer")).toBeTruthy();
    expect(within(panel).getByText("macOS · v1.12.5")).toBeTruthy();
    expect(within(panel).getByText("Sync off")).toBeTruthy();
    expect(within(panel).getByText("Your other computers appear here once sync is on.")).toBeTruthy();
    expect(within(panel).queryAllByRole("button")).toEqual([]);
    // Signed out, there is no cloud copy to delete.
    expect(screen.queryByRole("button", { name: /^Delete cloud copy…$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("shows a Windows computer's own platform", () => {
    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("trial_expired"), deviceSyncCanEnable: false, hostPlatform: "windows", appVersion: "1.12.5",
    })} />);
    expect(within(preview()!).getByText("Windows · v1.12.5")).toBeTruthy();
  });

  it("leaves the preview out once the real list or sync is there", () => {
    const { rerender } = render(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: true })} />);
    expect(preview()).toBeNull();
    expect(screen.getByRole("region", { name: "Your devices" })).toBeTruthy();

    rerender(<SyncSettingsSection {...devicesProps({
      billingEntitlement: { ...individualEntitlement, status: "trialing" }, deviceSyncEnabled: true, deviceSyncCanEnable: true,
    })} />);
    expect(preview()).toBeNull();
  });
});

describe("SyncSettingsSection Devices block", () => {
  const minute = 60_000;
  const deviceRecord = (overrides: Partial<NonNullable<SyncSettingsSectionProps["cloudDevices"]>[number]>) => ({
    id: "device",
    label: "Device",
    platform: "macos",
    appVersion: "1.12.4",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: new Date(Date.now() - 5 * minute).toISOString(),
    revokedAt: null,
    isCurrent: false,
    isActive: true,
    ...overrides,
  });
  const syncStatus = (overrides: Partial<NonNullable<SyncSettingsSectionProps["deviceSyncStatus"]>> = {}) => ({
    enabled: true, deviceId: "device-current", pendingPushCount: 0, backfill: null,
    lastPushedAt: new Date(Date.now() - 2 * minute).toISOString(), lastPulledAt: null,
    lastError: null, lastErrorCode: null, lastErrorHttpStatus: null, lastErrorLockedReason: null,
    ...overrides,
  });
  const devices = [
    deviceRecord({ id: "old", label: "Old laptop", isActive: false, lastSeenAt: "2026-08-25T02:34:00.000Z", appVersion: "0.9.0" }),
    deviceRecord({ id: "pc", label: "Studio PC", platform: "windows" }),
    deviceRecord({ id: "device-current", label: "This laptop", isCurrent: true }),
  ];

  it("puts the sync switch and cloud copy in the titled Sync block and the device list in its own block", () => {
    const view = render(<SyncSettingsSection {...devicesProps({ deviceSyncCanEnable: true, cloudDevices: devices })} />);

    const syncBlock = view.container.querySelector('[data-setting-id="settings.section.sync"]')!;
    const devicesBlock = view.container.querySelector('[data-setting-id="settings.cloudDevices.yourDevices"]')!;
    const syncRow = view.container.querySelector('[data-setting-id="settings.account.syncMacs"]')!;
    const heading = screen.getByRole("heading", { name: "Sync" });
    expect(syncBlock.contains(heading)).toBe(true);
    expect(heading.querySelector(".status-badge")).toBeNull();
    expect(within(syncRow as HTMLElement).getByText("Pro")).toBeTruthy();
    expect(within(syncRow as HTMLElement).getByText("Sync this device")).toBeTruthy();
    expect(syncBlock.contains(syncRow)).toBe(true);
    expect(syncBlock.contains(screen.getByRole("button", { name: /^Delete cloud copy…$/i }))).toBe(true);

    const list = screen.getByRole("region", { name: "Your devices" });
    expect(syncBlock.contains(list)).toBe(false);
    expect(devicesBlock.contains(list)).toBe(true);
    expect(within(devicesBlock as HTMLElement).getByRole("heading", { name: "Your devices" })).toBeTruthy();
    // The block heading names the list, so the card leads with the count instead of repeating the title.
    expect(within(list).queryByText("Your devices")).toBeNull();
    expect(within(list).getByText("2 of 3 in use")).toBeTruthy();
    expect(syncBlock.compareDocumentPosition(devicesBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.unmount();
  });

  it("lists this device first, then devices in use, then inactive ones, with this device's sync state", () => {
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: true, deviceSyncCanEnable: true, deviceSyncGateActive: true,
      deviceSyncStatus: syncStatus(), cloudDevices: devices,
    })} />);

    const rows = within(screen.getByRole("region", { name: "Your devices" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".cloud-device-row__name")?.textContent)).toEqual(["This laptop", "Studio PC", "Old laptop"]);
    expect(within(rows[0]).getByText("Sync on")).toBeTruthy();
    expect(within(rows[1]).getByText("Windows · last used 5 minutes ago · v1.12.4")).toBeTruthy();
    expect(within(rows[1]).getByText("In use")).toBeTruthy();
    expect(within(rows[2]).getByText("Inactive")).toBeTruthy();
    expect(screen.getByText("Synced 2 minutes ago")).toBeTruthy();
  });

  it("explains a sync failure on both the sync row and this device's row, and retries from there", async () => {
    const onDeviceSyncNow = vi.fn().mockResolvedValue(undefined);
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: true, deviceSyncCanEnable: true, deviceSyncGateActive: true,
      deviceSyncStatus: syncStatus({ lastError: "Failed to fetch" }), onDeviceSyncNow, cloudDevices: devices,
    })} />);

    expect(screen.getByText(/^Couldn’t sync: /)).toBeTruthy();
    const rows = within(screen.getByRole("region", { name: "Your devices" })).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Sync error")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(onDeviceSyncNow).toHaveBeenCalledOnce();
  });

  it("shows a manual sync as running until it settles", async () => {
    let finish: () => void = () => {};
    const onDeviceSyncNow = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<SyncSettingsSection {...devicesProps({
      deviceSyncEnabled: true, deviceSyncCanEnable: true, deviceSyncGateActive: true,
      deviceSyncStatus: syncStatus(), onDeviceSyncNow,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(screen.getByText("Syncing…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    await act(async () => { finish(); });
    expect(screen.getByText("Synced 2 minutes ago")).toBeTruthy();
    expect(onDeviceSyncNow).toHaveBeenCalledOnce();
  });

  it("explains a full device limit instead of offering sync on this device", () => {
    render(<SyncSettingsSection {...devicesProps({
      billingEntitlement: lockedEntitlement("device_limit_reached"),
      cloudDeviceAccess: { allowed: false, reason: "device_limit_reached", message: "Device limit reached.", activeDeviceCount: 3, maxActiveDevices: 3, activeWindowDays: 30, deviceId: null },
      deviceSyncCanEnable: false, cloudDevices: devices,
    })} />);

    expect(screen.getByText("Device limit reached. Remove a device below to sync this one.")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Toggle device sync" }) as HTMLButtonElement).disabled).toBe(true);
    const rows = within(screen.getByRole("region", { name: "Your devices" })).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Limit reached")).toBeTruthy();
  });
});
