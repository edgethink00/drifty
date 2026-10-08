// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppExclusionSettingsRows } from "./AppExclusionSettingsRows";
import { trackerClient } from "../../lib/api/trackerClient";
import { DEFAULT_EXCLUDED_APPS } from "@drifty/domain";

describe("AppExclusionSettingsRows", () => {
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

    render(<AppExclusionSettingsRows />);

    // The rows are the children of a settings group, so the title is a row label, not a card heading.
    expect(screen.getByText("Apps not to record")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();

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

    render(<AppExclusionSettingsRows />);

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

    render(<AppExclusionSettingsRows />);

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

    render(<AppExclusionSettingsRows />);

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

    render(<AppExclusionSettingsRows />);
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

  it("preserves a failed add, prevents duplicate writes, and retries a later count failure without saving again", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([]);
    vi.spyOn(trackerClient, "getRecentApps").mockResolvedValue([]);
    let rejectSave!: (error: Error) => void;
    const rule = { id: "Vault", name: "Vault", bundleId: null, source: "user" as const };
    const save = vi.spyOn(trackerClient, "saveExcludedApp")
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
      .mockResolvedValue(rule);
    const count = vi.mocked(trackerClient.getExcludedAppHistoryCount)
      .mockRejectedValueOnce(new Error("count unavailable")).mockResolvedValue({ count: 12 });
    render(<AppExclusionSettingsRows />);
    fireEvent.click(await screen.findByRole("button", { name: "Add app" }));
    const input = screen.getByLabelText("Find an app");
    fireEvent.change(input, { target: { value: "Vault" } });
    fireEvent.click(screen.getByRole("button", { name: "Add “Vault”" }));
    fireEvent.click(screen.getByRole("button", { name: "Add “Vault”" }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(input).toHaveProperty("disabled", true);
    await act(async () => rejectSave(new Error("write unavailable")));
    expect(screen.getByRole("alert").textContent).toContain("Could not add");
    expect(input).toHaveProperty("value", "Vault");
    fireEvent.click(screen.getByRole("button", { name: "Add “Vault”" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Record count unavailable");
    expect(screen.queryByLabelText("Find an app")).toBeNull();
    expect(screen.getByText("Vault")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Delete 12 records" });
    expect(count).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("locks only the affected row and keeps a failed unblock available for retry", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
      { id: "b", name: "Bank", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    let rejectRemove!: (error: Error) => void;
    const remove = vi.spyOn(trackerClient, "deleteExcludedApp")
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }))
      .mockResolvedValue({ deleted: true });
    render(<AppExclusionSettingsRows />);
    const unblock = await screen.findByRole("button", { name: "Unblock Vault" });
    const row = within(unblock.closest(".settings-row")! as HTMLElement);
    await row.findByRole("button", { name: "Delete 8 records" });
    fireEvent.click(unblock);
    fireEvent.click(unblock);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(row.getByRole("button", { name: "Delete 8 records" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Unblock Bank" })).toHaveProperty("disabled", false);
    await act(async () => rejectRemove(new Error("storage unavailable")));
    expect(row.getByRole("alert").textContent).toContain("Could not unblock");
    expect(unblock).toHaveProperty("disabled", false);
    fireEvent.click(unblock);
    await waitFor(() => expect(screen.queryByText("Vault")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("keeps the count after a failed history deletion and clears it only after a successful retry", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    const remove = vi.spyOn(trackerClient, "deleteExcludedAppHistory")
      .mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValue({ deleted: 8 });
    render(<AppExclusionSettingsRows />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete 8 records" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not delete");
    fireEvent.click(screen.getByRole("button", { name: "Delete 8 records" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete 8 records" })).toBeNull());
    expect(screen.getByText("Vault")).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("still accepts an initial count arriving during an unblock that fails", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    let finishCount!: (result: { count: number }) => void;
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockImplementationOnce(() => new Promise((resolve) => { finishCount = resolve; }));
    let rejectRemove!: (error: Error) => void;
    vi.spyOn(trackerClient, "deleteExcludedApp").mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }));
    render(<AppExclusionSettingsRows />);
    fireEvent.click(await screen.findByRole("button", { name: "Unblock Vault" }));
    await act(async () => finishCount({ count: 8 }));
    await act(async () => rejectRemove(new Error("storage unavailable")));
    expect(screen.getByRole("button", { name: "Delete 8 records" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("alert").textContent).toContain("Could not unblock");
  });
});
