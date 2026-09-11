// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppExclusionSettingsCard } from "./AppExclusionSettingsCard";
import { trackerClient } from "../../lib/api/trackerClient";
import { DEFAULT_EXCLUDED_APPS } from "@drifty/domain";

describe("AppExclusionSettingsCard", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(trackerClient, "getAppIcons").mockImplementation(async (apps) => {
      const result: Record<string, string | null> = {};
      for (const app of apps) {
        const key = app.bundleId || app.appName;
        // Mock 1Password, Keychain Access, MyBankApp as installed
        if (key.includes("1password") || key.includes("keychain") || key.includes("bank")) {
          result[key] = "data:image/png;base64,mockIcon";
        } else {
          result[key] = null;
        }
      }
      return result;
    });
    vi.spyOn(trackerClient, "getExcludedAppHistoryCount").mockResolvedValue({ count: 0 });
  });

  it("renders excluded apps in one list and allows unblocking an app", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      ...DEFAULT_EXCLUDED_APPS,
    ]);
    const deleteSpy = vi.spyOn(trackerClient, "deleteExcludedApp").mockResolvedValue({ deleted: true });

    render(<AppExclusionSettingsCard />);

    const cardToggle = screen.getByRole("button", { name: /Apps not to record/i });
    fireEvent.click(cardToggle);

    await waitFor(() => {
      expect(screen.getByText("1Password")).toBeTruthy();
      expect(screen.getByText("Keychain Access")).toBeTruthy();
    });

    expect(screen.queryByText("Added by you")).toBeNull();
    expect(screen.queryByText("Included from the start")).toBeNull();

    const unblockButtons = screen.getAllByRole("button", { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]!);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("com.1password.1password");
    });
  });

  it("allows adding a recent app to the excluded list", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "1", name: "1Password", bundleId: "com.1password", source: "default" },
    ]);
    vi.spyOn(trackerClient, "getRecentApps").mockResolvedValue([
      { name: "MyBankApp", bundleId: "com.bank.app", lastSeenAt: "2026-09-11T10:00:00Z", totalSeconds: 120 },
    ]);
    const saveSpy = vi.spyOn(trackerClient, "saveExcludedApp").mockResolvedValue({
      id: "com.bank.app",
      name: "MyBankApp",
      bundleId: "com.bank.app",
      source: "user",
    });

    render(<AppExclusionSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: /Apps not to record/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add app/i })).toBeTruthy();
      expect(screen.getByText("1Password")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add app/i }));

    await waitFor(() => {
      expect(screen.getByText("MyBankApp")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("MyBankApp"));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        name: "MyBankApp",
        bundleId: "com.bank.app",
        source: "user",
      }));
    });
  });

  it("lists user-added apps above defaults without source labels", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "com.1password.1password", name: "1Password", bundleId: "com.1password.1password", source: "default" },
      { id: "com.bank.app", name: "MyBankApp", bundleId: "com.bank.app", source: "user" },
    ]);

    render(<AppExclusionSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: /Apps not to record/i }));

    await waitFor(() => {
      expect(screen.getByText("MyBankApp")).toBeTruthy();
      expect(screen.getByText("1Password")).toBeTruthy();
    });

    const names = [...document.querySelectorAll(".excluded-apps-item__name")].map((node) => node.textContent);
    expect(names[0]).toBe("MyBankApp");
    expect(names[1]).toBe("1Password");
    expect(screen.queryByText("Added by you")).toBeNull();
    expect(screen.queryByText("Included from the start")).toBeNull();
  });

  it("filters out default apps that are not installed on this Mac", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      ...DEFAULT_EXCLUDED_APPS,
    ]);

    render(<AppExclusionSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: /Apps not to record/i }));

    await waitFor(() => {
      expect(screen.getByText("1Password")).toBeTruthy();
      expect(screen.getByText("Keychain Access")).toBeTruthy();
    });

    // Uninstalled apps like Bitwarden, Dashlane, Enpass should NOT be rendered
    expect(screen.queryByText("Bitwarden")).toBeNull();
    expect(screen.queryByText("Dashlane")).toBeNull();
    expect(screen.queryByText("Enpass")).toBeNull();
    expect(screen.queryByText("Keeper")).toBeNull();
  });

  it("lets a leftover typed name become a custom add", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "1", name: "1Password", bundleId: "com.1password", source: "default" },
    ]);
    vi.spyOn(trackerClient, "getRecentApps").mockResolvedValue([
      { name: "Safari", bundleId: "com.apple.Safari", lastSeenAt: "2026-09-11T10:00:00Z", totalSeconds: 60 },
    ]);
    const saveSpy = vi.spyOn(trackerClient, "saveExcludedApp").mockResolvedValue({
      id: "MyVault",
      name: "MyVault",
      bundleId: null,
      source: "user",
    });

    render(<AppExclusionSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: /Apps not to record/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Add app/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Add app/i }));

    const search = await screen.findByLabelText("Find an app");
    fireEvent.change(search, { target: { value: "MyVault" } });

    const addNamed = await screen.findByRole("button", { name: /Add “MyVault”/ });
    fireEvent.click(addNamed);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        name: "MyVault",
        bundleId: null,
        source: "user",
      }));
    });
  });
});
