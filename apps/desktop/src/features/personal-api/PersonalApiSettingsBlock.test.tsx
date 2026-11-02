// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PersonalApiSettingsBlock } from "./PersonalApiSettingsBlock";
import { PersonalApiKeysError, type PersonalApiKey, type PersonalApiKeysClient } from "./personalApiKeysClient";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

const pro: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: "2099-01-01T00:00:00Z" };
const locked: BillingEntitlement = { plan: "individual", status: "locked", canUseApp: false, trialEndsAt: "2026-10-01T00:00:00Z", currentPeriodEnd: null, lockedReason: "trial_expired" };
// An active plan seen from a fourth computer: the app locks this computer, the server still serves the account's keys.
const deviceLimited: BillingEntitlement = {
  ...pro,
  status: "locked",
  canUseApp: false,
  lockedReason: "device_limit_reached",
  deviceAccess: { allowed: false, reason: "device_limit_reached", message: null, activeDeviceCount: 3, maxActiveDevices: 3, activeWindowDays: 30, deviceId: null },
};

function key(overrides: Partial<PersonalApiKey> = {}): PersonalApiKey {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "My site",
    hint: "Ab1z",
    scopes: ["summary:read"],
    // Midday, so the dates read the same in any test time zone.
    createdAt: "2026-10-20T12:00:00Z",
    expiresAt: "2027-01-18T12:00:00Z",
    lastUsedAt: null,
    ...overrides,
  };
}

function mockClient(keys: PersonalApiKey[] = []) {
  return {
    list: vi.fn<PersonalApiKeysClient["list"]>().mockResolvedValue(keys),
    create: vi.fn<PersonalApiKeysClient["create"]>(),
    remove: vi.fn<PersonalApiKeysClient["remove"]>().mockResolvedValue(undefined),
  };
}

/** A key row's meta line as read: its masked token, then its facts. */
function metaOf(name: string): string | null | undefined {
  return screen.getByText(name).closest("li")?.querySelector(".cloud-device-row__meta")?.textContent;
}

function renderBlock(props: Partial<Parameters<typeof PersonalApiSettingsBlock>[0]> = {}) {
  return render(
    <LocalizationTestProvider language="en">
      <PersonalApiSettingsBlock
        accountId={ACCOUNT}
        billingEntitlement={pro}
        deviceSyncEnabled
        now={() => NOW}
        {...props}
      />
    </LocalizationTestProvider>,
  );
}

/** This computer's sync as the app holds it: off until a turn-on succeeds. */
function SyncingBlock({ turnOn, ...props }: Partial<Parameters<typeof PersonalApiSettingsBlock>[0]> & { readonly turnOn: () => Promise<boolean> }) {
  const [syncOn, setSyncOn] = useState(false);
  return (
    <PersonalApiSettingsBlock
      accountId={ACCOUNT}
      billingEntitlement={pro}
      now={() => NOW}
      {...props}
      deviceSyncEnabled={syncOn}
      deviceSyncCanEnable
      onEnableDeviceSync={async () => {
        const enabled = await turnOn();
        if (enabled) setSyncOn(true);
        return enabled;
      }}
    />
  );
}

function renderSyncingBlock(props: Parameters<typeof SyncingBlock>[0]) {
  return render(
    <LocalizationTestProvider language="en">
      <SyncingBlock {...props} />
    </LocalizationTestProvider>,
  );
}

/** Agrees in Sync's own consent dialog, the one Settings › Sync opens. */
async function agreeToSync() {
  const consent = await screen.findByRole("dialog", { name: "Turn on device sync?" });
  await act(async () => {
    fireEvent.click(within(consent).getByRole("button", { name: "Turn on sync" }));
  });
}

describe("PersonalApiSettingsBlock", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    cleanup();
  });

  it("asks a signed-out person to sign in and reads no keys", () => {
    const client = mockClient();
    const onSignIn = vi.fn();
    renderBlock({ accountId: null, billingEntitlement: null, client, onSignIn });
    expect(screen.getByText("Sign in with a Pro account to create API keys.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(client.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New key" })).toBeNull();
  });

  it("offers Pro without a plan and still lists earlier keys so they can be deleted", async () => {
    const client = mockClient([
      key(),
      key({ id: "55555555-5555-4555-8555-555555555555", name: "Old", hint: "Oo55", expiresAt: "2026-10-01T12:00:00Z" }),
    ]);
    const onUpgradeToPro = vi.fn();
    renderBlock({ billingEntitlement: locked, client, onUpgradeToPro });
    expect(await screen.findByText("My site")).toBeTruthy();
    expect(screen.getByText("API keys come with Pro.")).toBeTruthy();
    // A working key is paused while Pro is off; an expired one stays expired.
    expect(screen.getByText("Paused").closest("li")?.textContent).toContain("My site");
    expect(screen.getByText("Expired").closest("li")?.textContent).toContain("Old");
    expect(screen.queryByRole("button", { name: "New key" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Options for My site (…Ab1z)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete key…" }));
    expect(await screen.findByRole("dialog", { name: "Delete My site?" })).toBeTruthy();
  });

  it("says why New key waits while the plan is unread or could not be read", async () => {
    renderBlock({ client: mockClient(), billingEntitlement: null });
    expect(screen.getByText("Checking your plan…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderBlock({ client: mockClient(), billingEntitlement: null, billingEntitlementError: "offline" });
    expect(screen.getByText("Your plan could not be checked. See Settings › Account.")).toBeTruthy();
  });

  it("describes each key by its masked token, permissions, dates and last use", async () => {
    const client = mockClient([
      key(),
      key({ id: "33333333-3333-4333-8333-333333333333", name: "Script", hint: "Zz99", scopes: ["activity:read", "summary:read"], lastUsedAt: "2026-10-25T08:00:00Z", expiresAt: "2026-10-01T12:00:00Z" }),
      key({ id: "44444444-4444-4444-8444-444444444444", name: "Forever", hint: "Qq11", expiresAt: null, lastUsedAt: "2026-10-25T08:00:00Z" }),
      key({ id: "66666666-6666-4666-8666-666666666666", name: "Weekly", hint: "Ww66", createdAt: "2026-09-10T12:00:00Z", expiresAt: null, lastUsedAt: "2026-10-16T12:00:00Z" }),
      key({ id: "77777777-7777-4777-8777-777777777777", name: "Last year", hint: "Ly77", createdAt: "2025-11-02T12:00:00Z", expiresAt: null, lastUsedAt: "2025-12-20T12:00:00Z" }),
    ]);
    renderBlock({ client });
    expect(await screen.findByText("drifty_sk_…Ab1z")).toBeTruthy();
    expect(metaOf("My site")).toBe("drifty_sk_…Ab1z · Summary · Created Oct 20 · Expires Jan 18, 2027");
    expect(screen.getByText("Not used yet")).toBeTruthy();
    // An expired key says so once, in its dimmed status.
    expect(metaOf("Script")).toBe("drifty_sk_…Zz99 · Summary, Activity · Created Oct 20");
    expect(screen.getByText("Expired").closest("li")?.className).toContain("is-inactive");
    // Recent use reads as in use.
    expect(metaOf("Forever")).toBe("drifty_sk_…Qq11 · Summary · Created Oct 20 · No expiry");
    expect(screen.getByText("Used yesterday").className).toContain("cloud-device-row__status--ok");
    // Use older than a week is dated and muted, with the year once it is not this year's.
    expect(screen.getByText("Used on Oct 16").className).toContain("cloud-device-row__status--active");
    expect(screen.getByText("Used on Dec 20, 2025")).toBeTruthy();
    expect(metaOf("Last year")).toBe("drifty_sk_…Ly77 · Summary · Created Nov 2, 2025 · No expiry");
    expect(client.list).toHaveBeenCalledWith(ACCOUNT);
  });

  it("says why New key is off at the key limit", async () => {
    const keys = Array.from({ length: 10 }, (_, index) => key({ id: "key-" + index, name: "Key " + index, hint: "K" + String(index).padStart(3, "0") }));
    renderBlock({ client: mockClient(keys) });
    expect(await screen.findByText("An account can have 10 keys. Delete one, then create a new one.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a key's menu from the keyboard and closes it with Escape", async () => {
    renderBlock({ client: mockClient([key()]) });
    const trigger = await screen.findByRole("button", { name: "Options for My site (…Ab1z)" });
    trigger.focus();
    fireEvent.click(trigger, { detail: 0 });
    const item = screen.getByRole("menuitem", { name: "Delete key…" });
    await waitFor(() => expect(document.activeElement).toBe(item));
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      item.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("says this computer's records stay out of the API and turns sync on only after Sync's consent", async () => {
    let finish: (enabled: boolean) => void = () => undefined;
    const turnOn = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    renderSyncingBlock({ client: mockClient(), turnOn });
    expect(await screen.findByText("Keys you create appear here.")).toBeTruthy();
    expect(screen.getByText("Sync is off on this computer, so its records don't reach the API.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on sync…" }));
    // Opening the dialog uploads nothing; only its own button does.
    expect(await screen.findByRole("dialog", { name: "Turn on device sync?" })).toBeTruthy();
    expect(turnOn).not.toHaveBeenCalled();
    await agreeToSync();
    expect(turnOn).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("Turning on sync…");
    await act(async () => {
      finish(true);
    });
    expect(screen.queryByText(/Sync is off on this computer/)).toBeNull();
    expect(screen.queryByText("Turning on sync…")).toBeNull();
  });

  it("says when turning sync on did not take and offers it again", async () => {
    const turnOn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderSyncingBlock({ client: mockClient(), turnOn });
    fireEvent.click(await screen.findByRole("button", { name: "Turn on sync…" }));
    await agreeToSync();
    expect(await screen.findByText("Sync could not be turned on.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on sync…" }));
    await agreeToSync();
    await waitFor(() => expect(screen.queryByText("Sync could not be turned on.")).toBeNull());
    expect(turnOn).toHaveBeenCalledTimes(2);
  });

  it("links to Sync settings when sync cannot be turned on from here", async () => {
    const onOpenSyncSettings = vi.fn();
    renderBlock({ client: mockClient(), deviceSyncEnabled: false, deviceSyncCanEnable: false, onEnableDeviceSync: vi.fn(), onOpenSyncSettings });
    expect(await screen.findByText("Sync is off on this computer, so its records don't reach the API.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn on sync…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sync settings" }));
    expect(onOpenSyncSettings).toHaveBeenCalledOnce();
  });

  it("turns sync on before the first key when no computer on the account syncs", async () => {
    const turnOn = vi.fn().mockResolvedValue(true);
    const readAccountSyncing = vi.fn().mockResolvedValue(false);
    renderSyncingBlock({ client: mockClient(), turnOn, readAccountSyncing });
    expect(await screen.findByText("No computer on this account syncs, so no new records reach the API. Turn on sync first.")).toBeTruthy();
    // New key keeps its name and turns sync on first; the line beside it, which it points to, says why.
    expect(screen.queryByRole("button", { name: "Turn on sync…" })).toBeNull();
    const syncFirst = screen.getByRole("button", { name: "New key" }) as HTMLButtonElement;
    expect(syncFirst.disabled).toBe(false);
    expect(syncFirst.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(syncFirst.getAttribute("aria-describedby") ?? "")?.textContent).toContain("No computer on this account syncs");

    // A key with nothing to read is not made: the consent comes first, and cancelling it uploads nothing and makes no key.
    fireEvent.click(syncFirst);
    const consent = await screen.findByRole("dialog", { name: "Turn on device sync?" });
    expect(screen.queryByRole("dialog", { name: "New API key" })).toBeNull();
    fireEvent.click(within(consent).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(turnOn).not.toHaveBeenCalled();

    fireEvent.click(syncFirst);
    await agreeToSync();
    expect(turnOn).toHaveBeenCalledOnce();
    // Once sync is on, the key's own dialog follows without another click.
    expect(await screen.findByRole("dialog", { name: "New API key" })).toBeTruthy();
    expect(screen.queryByText(/No computer on this account syncs/)).toBeNull();
  });

  it("makes no key when that turn-on fails, and offers it again", async () => {
    const turnOn = vi.fn().mockResolvedValue(false);
    renderSyncingBlock({ client: mockClient(), turnOn, readAccountSyncing: vi.fn().mockResolvedValue(false) });
    expect(await screen.findByText("No computer on this account syncs, so no new records reach the API. Turn on sync first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New key" }));
    await agreeToSync();
    expect(await screen.findByText("Sync could not be turned on.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "New API key" })).toBeNull();
    // The same New key tries again through the consent.
    fireEvent.click(screen.getByRole("button", { name: "New key" }));
    expect(await screen.findByRole("dialog", { name: "Turn on device sync?" })).toBeTruthy();
  });

  it("makes a key at once when another computer syncs, and says this one is left out", async () => {
    const onEnableDeviceSync = vi.fn();
    renderBlock({ client: mockClient(), deviceSyncEnabled: false, deviceSyncCanEnable: true, onEnableDeviceSync, readAccountSyncing: vi.fn().mockResolvedValue(true) });
    expect(await screen.findByText("Sync is off on this computer, so its records are left out. Your other syncing computers still come through.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New key" }));
    expect(await screen.findByRole("dialog", { name: "New API key" })).toBeTruthy();
    expect(onEnableDeviceSync).not.toHaveBeenCalled();
  });

  it("keeps New key off on a computer over the limit while no computer syncs", async () => {
    const onOpenSyncSettings = vi.fn();
    renderBlock({
      billingEntitlement: deviceLimited,
      client: mockClient(),
      deviceSyncEnabled: false,
      deviceSyncCanEnable: false,
      onEnableDeviceSync: vi.fn(),
      readAccountSyncing: vi.fn().mockResolvedValue(false),
      onOpenSyncSettings,
    });
    expect(await screen.findByText("No computer on this account syncs, and this one is over the device limit. Turn on sync on another computer, or remove one in Sync settings.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sync settings" }));
    expect(onOpenSyncSettings).toHaveBeenCalledOnce();
  });

  it("blocks nothing when the account's computers cannot be read", async () => {
    renderBlock({ client: mockClient(), deviceSyncEnabled: false, deviceSyncCanEnable: true, onEnableDeviceSync: vi.fn(), readAccountSyncing: vi.fn().mockRejectedValue(new Error("offline")) });
    expect(await screen.findByText("Keys you create appear here.")).toBeTruthy();
    expect(screen.getByText("Sync is off on this computer, so its records don't reach the API.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds New key while the account's computers are read, so it never offers a key and then takes it back", async () => {
    let answer: (syncing: boolean) => void = () => undefined;
    const readAccountSyncing = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    renderBlock({ client: mockClient(), deviceSyncEnabled: false, deviceSyncCanEnable: true, onEnableDeviceSync: vi.fn(), readAccountSyncing });
    expect(await screen.findByText("Keys you create appear here.")).toBeTruthy();
    expect(screen.getByText("Checking which computers sync…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      answer(false);
    });
    expect(screen.queryByText("Checking which computers sync…")).toBeNull();
    const newKey = screen.getByRole("button", { name: "New key" }) as HTMLButtonElement;
    expect(newKey.disabled).toBe(false);
    expect(newKey.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("keeps the account's keys working on a computer over the device limit and says why its records stay out", async () => {
    const onOpenSyncSettings = vi.fn();
    renderBlock({ billingEntitlement: deviceLimited, client: mockClient([key()]), deviceSyncEnabled: true, deviceSyncCanEnable: false, onEnableDeviceSync: vi.fn(), onOpenSyncSettings });
    expect(await screen.findByText("My site")).toBeTruthy();
    expect(screen.queryByText("API keys come with Pro.")).toBeNull();
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByText("Not used yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "New key" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("This computer is over the device limit and doesn't sync, so its records don't reach the API.")).toBeTruthy();
    // Room is made in Sync's device list, not by turning sync on here.
    expect(screen.queryByRole("button", { name: "Turn on sync…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sync settings" }));
    expect(onOpenSyncSettings).toHaveBeenCalledOnce();
  });

  it("says beside a new key why its command will come back without this computer, and keeps the key while sync turns on", async () => {
    const client = mockClient();
    const token = "drifty_sk_" + "b".repeat(36) + "QRST";
    client.create.mockResolvedValue({ key: key({ name: "Blog", hint: "QRST" }), token });
    renderSyncingBlock({ client, turnOn: vi.fn().mockResolvedValue(true) });
    fireEvent.click(await screen.findByRole("button", { name: "New key" }));
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. My website"), { target: { value: "Blog" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Create key/ }));
    });

    const reveal = await screen.findByRole("dialog", { name: "Copy your key" });
    expect(within(reveal).getByText("Sync is off on this computer, so this command won't show its records yet.")).toBeTruthy();
    fireEvent.click(within(reveal).getByRole("button", { name: "Turn on sync…" }));
    await agreeToSync();
    // The consent dialog closed over the key instead of replacing it.
    expect(await within(reveal).findByText("Sync is on. This computer's records can take a few minutes to reach the API.")).toBeTruthy();
    expect(within(reveal).getByText(token)).toBeTruthy();

    fireEvent.click(within(reveal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Blog")).toBeTruthy();
    expect(screen.queryByText(/Sync is (on|off)/)).toBeNull();
  });

  it("creates a key and shows it once with a command to try", async () => {
    const client = mockClient();
    const token = "drifty_sk_" + "a".repeat(36) + "WXYZ";
    client.create.mockResolvedValue({ key: key({ name: "Blog", hint: "WXYZ", scopes: ["activity:read", "summary:read"] }), token });
    renderBlock({ client });
    fireEvent.click(await screen.findByRole("button", { name: "New key" }));

    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    const create = within(dialog).getByRole("button", { name: /Create key/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. My website"), { target: { value: " Blog " } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Activity/ }));
    expect(create.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(create);
    });

    expect(client.create).toHaveBeenCalledWith(ACCOUNT, { name: "Blog", scopes: ["summary:read", "activity:read"], expiresInDays: 90 });
    const reveal = await screen.findByRole("dialog", { name: "Copy your key" });
    expect(within(reveal).getByText(token)).toBeTruthy();
    // Where to keep it is said where the key is copied, not under the list.
    expect(within(reveal).getByText(/Don't put it in a web page's code/)).toBeTruthy();
    expect(within(reveal).getByText(new RegExp(`curl -H "Authorization: Bearer ${token}" "https://drifty.so/api/v1/summary\\?tz=`))).toBeTruthy();
    fireEvent.click(within(reveal).getByRole("button", { name: `Copy: ${token}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    fireEvent.click(within(reveal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Blog")).toBeTruthy();
    expect(screen.queryByText(token)).toBeNull();
  });

  it("keeps the form and says why when a key cannot be created", async () => {
    const client = mockClient();
    client.create.mockRejectedValue(new PersonalApiKeysError("key_limit_reached", "limit"));
    renderBlock({ client });
    fireEvent.click(await screen.findByRole("button", { name: "New key" }));
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. My website"), { target: { value: "Blog" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Create key/ }));
    });
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "An account can have 10 keys. Delete one, then create a new one.");
    expect((within(dialog).getByPlaceholderText("e.g. My website") as HTMLInputElement).value).toBe("Blog");
  });

  it("deletes a key from its menu after asking, once the server confirms", async () => {
    const client = mockClient([key()]);
    client.remove.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    renderBlock({ client });
    fireEvent.click(await screen.findByRole("button", { name: "Options for My site (…Ab1z)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete key…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete My site?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete key" }));
    });
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "The key could not be deleted. Try again.");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete key" }));
    });
    await waitFor(() => expect(screen.queryByText("My site")).toBeNull());
    expect(client.remove).toHaveBeenLastCalledWith(ACCOUNT, "22222222-2222-4222-8222-222222222222");
    // Its menu button is gone, so focus moves on to New key rather than the page.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New key" }));
  });

  it("hands focus to the plan's action after deleting the last key without Pro", async () => {
    const client = mockClient([key()]);
    renderBlock({ billingEntitlement: locked, client, onUpgradeToPro: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Options for My site (…Ab1z)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete key…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete My site?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete key" }));
    });
    await waitFor(() => expect(screen.queryByText("My site")).toBeNull());
    expect((document.activeElement as HTMLElement | null)?.className).toContain("settings-btn--primary");
  });

  it("offers a retry when the keys cannot be read", async () => {
    const client = mockClient();
    client.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([key()]);
    renderBlock({ client });
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("My site")).toBeTruthy();
  });
});
