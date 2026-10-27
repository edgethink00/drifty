// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingEntitlement } from "../billing/billingService";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PersonalApiSettingsBlock } from "./PersonalApiSettingsBlock";
import { PersonalApiKeysError, type PersonalApiKey, type PersonalApiKeysClient } from "./personalApiKeysClient";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

const pro: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: "2099-01-01T00:00:00Z" };
const locked: BillingEntitlement = { plan: "individual", status: "locked", canUseApp: false, trialEndsAt: "2026-10-01T00:00:00Z", currentPeriodEnd: null, lockedReason: "trial_expired" };

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

  it("says when this computer does not sync and opens Sync settings", async () => {
    const onOpenSyncSettings = vi.fn();
    renderBlock({ client: mockClient(), deviceSyncEnabled: false, onOpenSyncSettings });
    expect(await screen.findByText("Keys you create appear here.")).toBeTruthy();
    expect(screen.getByText("Sync is off on this computer. The API reads only records synced to Drifty Cloud.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sync settings" }));
    expect(onOpenSyncSettings).toHaveBeenCalledOnce();
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
