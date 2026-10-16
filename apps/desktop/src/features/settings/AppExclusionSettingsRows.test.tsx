// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExclusionSettingsRows } from "./AppExclusionSettingsRows";
import { trackerClient } from "../../lib/api/trackerClient";
import { DEFAULT_EXCLUDED_APPS } from "@drifty/domain";

/** An excluded item's chip, found by the name it starts with. */
function chipFor(name: string): HTMLElement {
  const chip = screen.getAllByRole("button").find((button) => button.getAttribute("aria-haspopup") === "menu" && button.querySelector(".excluded-apps-chip__name")?.textContent === name);
  if (!chip) throw new Error(`No chip for ${name}`);
  return chip;
}

const SEARCH = "App name or site address";
const PICKER = "Apps and sites you can hide";

/** The search beside the title opens its panel of candidates on a click. */
async function openPicker(): Promise<HTMLElement> {
  const search = await screen.findByRole("searchbox", { name: SEARCH });
  fireEvent.click(search);
  return search;
}

/** Opens an item's menu from its chip. A closing menu can linger for its exit, so look in the chip's own slot. */
async function openItemMenu(name: string): Promise<HTMLElement> {
  await screen.findByText(name);
  const chip = chipFor(name);
  fireEvent.click(chip);
  return within(chip.closest("li")!).findByRole("menu", { name });
}

describe("ExclusionSettingsRows", () => {
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
    vi.spyOn(trackerClient, "searchClassificationRuleCandidates").mockResolvedValue([]);
  });

  it("shows excluded apps as chips in the label row and unblocks one from its menu", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      ...DEFAULT_EXCLUDED_APPS,
    ]);
    const deleteSpy = vi.spyOn(trackerClient, "deleteExcludedApp").mockResolvedValue({ deleted: true });

    render(<ExclusionSettingsRows />);

    // The rows are the children of a settings group, so the title is a row label, not a card heading.
    expect(screen.getByText("Apps and sites not to record")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("1Password")).toBeTruthy();
      expect(screen.getByText("Keychain Access")).toBeTruthy();
    });

    // Each app is a chip in the one label row, not a settings row of its own.
    expect(document.querySelectorAll(".settings-row")).toHaveLength(1);
    expect(within(screen.getByRole("list", { name: "Apps and sites not to record" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Added by you")).toBeNull();
    expect(screen.queryByText("Included from the start")).toBeNull();

    // The whole chip is the menu's control; it carries no ⋮ mark.
    expect(chipFor("1Password").querySelector("svg")).toBeNull();

    // With no past records left, the menu only unblocks.
    const menu = await openItemMenu("1Password");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Unblock"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Unblock" }));

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

    render(<ExclusionSettingsRows />);

    await waitFor(() => expect(screen.getByText("1Password")).toBeTruthy());

    await openPicker();

    // The panel offers candidates as chips too, over the list, which stays in place.
    const picker = await screen.findByRole("region", { name: PICKER });
    expect(screen.getByText("1Password")).toBeTruthy();
    fireEvent.click(within(picker).getByRole("button", { name: "MyBankApp" }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
        name: "MyBankApp",
        bundleId: "com.bank.app",
        source: "user",
      }));
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: PICKER })).toBeNull());
    expect(within(screen.getByRole("list", { name: "Apps and sites not to record" })).getByText("MyBankApp")).toBeTruthy();
    // The search keeps focus for the next one.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: SEARCH })));
  });

  it("lists user-added apps above defaults without source labels", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "com.1password.1password", name: "1Password", bundleId: "com.1password.1password", source: "default" },
      { id: "com.bank.app", name: "MyBankApp", bundleId: "com.bank.app", source: "user" },
    ]);

    render(<ExclusionSettingsRows />);

    await waitFor(() => {
      expect(screen.getByText("MyBankApp")).toBeTruthy();
      expect(screen.getByText("1Password")).toBeTruthy();
    });

    const names = [...document.querySelectorAll(".excluded-apps-chip__name")].map((node) => node.textContent);
    expect(names[0]).toBe("MyBankApp");
    expect(names[1]).toBe("1Password");
    expect(screen.queryByText("Added by you")).toBeNull();
    expect(screen.queryByText("Included from the start")).toBeNull();
  });

  it("filters out default apps that are not installed on this Mac", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      ...DEFAULT_EXCLUDED_APPS,
    ]);

    render(<ExclusionSettingsRows />);

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

    render(<ExclusionSettingsRows />);
    // Typing alone opens the panel.
    const search = await screen.findByRole("searchbox", { name: SEARCH });
    fireEvent.change(search, { target: { value: "MyVault" } });

    const addNamed = await screen.findByRole("button", { name: "Add app “MyVault”" });
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
    render(<ExclusionSettingsRows />);
    const input = await openPicker();
    fireEvent.change(input, { target: { value: "Vault" } });
    fireEvent.click(screen.getByRole("button", { name: "Add app “Vault”" }));
    fireEvent.click(screen.getByRole("button", { name: "Add app “Vault”" }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(input).toHaveProperty("disabled", true);
    await act(async () => rejectSave(new Error("write unavailable")));
    expect(screen.getByRole("alert").textContent).toContain("Could not add");
    expect(input).toHaveProperty("value", "Vault");
    fireEvent.click(screen.getByRole("button", { name: "Add app “Vault”" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Record count unavailable");
    await waitFor(() => expect(screen.queryByRole("region", { name: PICKER })).toBeNull());
    expect(screen.getByText("Vault")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("12 existing records");
    expect(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Delete 12 records…" })).toBeTruthy();
    expect(count).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("locks only the affected chip and keeps a failed unblock available for retry", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
      { id: "b", name: "Bank", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    let rejectRemove!: (error: Error) => void;
    const remove = vi.spyOn(trackerClient, "deleteExcludedApp")
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }))
      .mockResolvedValue({ deleted: true });
    render(<ExclusionSettingsRows />);
    await waitFor(() => expect(screen.getAllByText("8 existing records")).toHaveLength(2));
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Unblock" }));
    const vault = chipFor("Vault");
    expect(vault).toHaveProperty("disabled", true);
    expect(vault.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(vault);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(chipFor("Bank")).toHaveProperty("disabled", false);
    await act(async () => rejectRemove(new Error("storage unavailable")));
    expect(screen.getByRole("alert").textContent).toContain("Could not unblock");
    expect(screen.getByRole("alert").textContent).toContain("Vault");
    expect(vault).toHaveProperty("disabled", false);
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Unblock" }));
    await waitFor(() => expect(screen.queryByText("Vault")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before deleting an excluded app's records, keeps a failure in the dialog and clears the count after a retry", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    const remove = vi.spyOn(trackerClient, "deleteExcludedAppHistory")
      .mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValue({ deleted: 8 });
    render(<ExclusionSettingsRows />);
    await screen.findByText("8 existing records");
    const menu = await openItemMenu("Vault");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Unblock", "Delete 8 records…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete 8 records…" }));
    // The menu item only opens the confirmation; nothing is deleted yet.
    const dialog = await screen.findByRole("dialog", { name: "Delete 8 Vault records?" });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete records" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Could not delete");
    expect(alert.getAttribute("title")).toBe("storage unavailable");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete records" }));
    await waitFor(() => expect(screen.queryByText("8 existing records")).toBeNull());
    expect(screen.getByText("Vault")).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(within(await openItemMenu("Vault")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Unblock"]);
  });

  it("cancels the record deletion without touching the records", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    const remove = vi.spyOn(trackerClient, "deleteExcludedAppHistory").mockResolvedValue({ deleted: 8 });
    render(<ExclusionSettingsRows />);
    await screen.findByText("8 existing records");
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Delete 8 records…" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText("8 existing records")).toBeTruthy();
  });

  it("opens a chip's menu from the keyboard and returns focus to the chip", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    render(<ExclusionSettingsRows />);
    await screen.findByText("8 existing records");
    const chip = chipFor("Vault");
    chip.focus();
    fireEvent.keyDown(chip, { key: "ArrowDown" });
    const menu = await within(chip.closest("li")!).findByRole("menu", { name: "Vault" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Unblock"));
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Delete 8 records…");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Unblock");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(menu).toBeTruthy();
  });

  it("keeps keyboard focus in the list when the focused chip goes away or its records are deleted", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
      { id: "b", name: "Safe", bundleId: null, source: "user" },
    ]);
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 8 });
    vi.spyOn(trackerClient, "deleteExcludedAppHistory").mockResolvedValue({ deleted: 8 });
    vi.spyOn(trackerClient, "deleteExcludedApp").mockResolvedValue({ deleted: true });
    render(<ExclusionSettingsRows />);
    await waitFor(() => expect(screen.getAllByText("8 existing records")).toHaveLength(2));

    // Deleting the records closes the confirmation; focus comes back to the same chip.
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Delete 8 records…" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete records" }));
    await waitFor(() => expect(document.activeElement).toBe(chipFor("Vault")));

    // An unblocked chip hands focus to the next chip, and the last one to the search.
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Unblock" }));
    await waitFor(() => expect(document.activeElement).toBe(chipFor("Safe")));
    fireEvent.click(within(await openItemMenu("Safe")).getByRole("menuitem", { name: "Unblock" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: SEARCH })));
  });

  it("still accepts an initial count arriving during an unblock that fails", async () => {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([
      { id: "a", name: "Vault", bundleId: null, source: "user" },
    ]);
    let finishCount!: (result: { count: number }) => void;
    vi.mocked(trackerClient.getExcludedAppHistoryCount).mockImplementationOnce(() => new Promise((resolve) => { finishCount = resolve; }));
    let rejectRemove!: (error: Error) => void;
    vi.spyOn(trackerClient, "deleteExcludedApp").mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }));
    render(<ExclusionSettingsRows />);
    fireEvent.click(within(await openItemMenu("Vault")).getByRole("menuitem", { name: "Unblock" }));
    await act(async () => finishCount({ count: 8 }));
    await act(async () => rejectRemove(new Error("storage unavailable")));
    expect(screen.getByText("8 existing records")).toBeTruthy();
    expect(chipFor("Vault")).toHaveProperty("disabled", false);
    expect(screen.getByRole("alert").textContent).toContain("Could not unblock");
  });
});

describe("ExclusionSettingsRows with sites", () => {
  afterEach(cleanup);

  const bankSite = { id: "site:kbstar.com", name: "kbstar.com", bundleId: null, source: "user" as const, kind: "site" as const };
  const siteCandidate = (value: string, seconds: number) => ({ id: `site:${value}`, targetKind: "site" as const, targetValue: value, displayName: value, appName: "Safari", bundleId: null, category: "utility" as const, productivity: "neutral" as const, segmentCount: 1, totalSeconds: seconds });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(trackerClient, "getAppIcons").mockResolvedValue({});
    vi.spyOn(trackerClient, "getExcludedAppHistoryCount").mockResolvedValue({ count: 0 });
    vi.spyOn(trackerClient, "searchClassificationRuleCandidates").mockResolvedValue([]);
    vi.spyOn(trackerClient, "getRecentApps").mockResolvedValue([]);
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue([...DEFAULT_EXCLUDED_APPS, bankSite]);
  });

  it("keeps apps and sites in one list and adds a pasted address as a site and a plain name as an app", async () => {
    const save = vi.spyOn(trackerClient, "saveExcludedApp").mockImplementation(async (rule) => rule);
    render(<ExclusionSettingsRows />);
    expect(await screen.findByText("kbstar.com")).toBeTruthy();
    expect(screen.getAllByRole("list")).toHaveLength(1);
    // A site's lettered mark never looks its favicon up.
    expect(document.querySelector(".excluded-apps-chip .site-favicon")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: SEARCH }), { target: { value: "https://www.HomeTax.go.kr/websquare?w2xPath=1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add site “hometax.go.kr”" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "site:hometax.go.kr", name: "hometax.go.kr", bundleId: null, source: "user", kind: "site" }));
    expect(await screen.findByText("hometax.go.kr")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: SEARCH }), { target: { value: "MyVault" } });
    expect(screen.queryByRole("button", { name: /Add site/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Add app “MyVault”" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "MyVault", name: "MyVault", bundleId: null, source: "user", kind: "app" }));
    // The list never asks for a site's icon: an uncached favicon lookup would send the hidden address out.
    expect(vi.mocked(trackerClient.getAppIcons).mock.calls.flat(2).some((app) => app.appName.includes("."))).toBe(false);
  });

  it("counts and deletes a site's past records by its domain", async () => {
    vi.mocked(trackerClient.getExcludedApps).mockResolvedValue([bankSite]);
    const count = vi.mocked(trackerClient.getExcludedAppHistoryCount).mockResolvedValue({ count: 3 });
    const remove = vi.spyOn(trackerClient, "deleteExcludedAppHistory").mockResolvedValue({ deleted: 3 });
    render(<ExclusionSettingsRows />);
    await screen.findByText("3 existing records");
    fireEvent.click(within(await openItemMenu("kbstar.com")).getByRole("menuitem", { name: "Delete 3 records…" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Delete 3 kbstar.com records?" })).getByRole("button", { name: "Delete records" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ name: "kbstar.com", bundleId: null, siteDomain: "kbstar.com" }));
    expect(count).toHaveBeenCalledWith({ name: "kbstar.com", bundleId: null, siteDomain: "kbstar.com" });
  });

  it("offers recent apps and recorded sites in two groups that one search narrows", async () => {
    vi.mocked(trackerClient.getExcludedApps).mockResolvedValue([]);
    vi.mocked(trackerClient.getRecentApps).mockResolvedValue([
      { name: "KB Star Banking", bundleId: "com.kb.star", lastSeenAt: "2026-10-16T09:00:00Z", totalSeconds: 600 },
      { name: "Safari", bundleId: "com.apple.Safari", lastSeenAt: "2026-10-16T09:00:00Z", totalSeconds: 6000 },
    ]);
    vi.mocked(trackerClient.searchClassificationRuleCandidates).mockResolvedValue([
      siteCandidate("www.youtube.com", 5400), siteCandidate("youtube.com", 600), siteCandidate("obank.kbstar.com", 1080), siteCandidate("kbstar.com", 240),
    ]);
    const save = vi.spyOn(trackerClient, "saveExcludedApp").mockImplementation(async (rule) => rule);
    render(<ExclusionSettingsRows />);
    await openPicker();
    const picker = await screen.findByRole("region", { name: PICKER });
    const apps = await within(picker).findByRole("list", { name: "Recent apps" });
    const sites = await within(picker).findByRole("list", { name: "Recorded sites" });
    expect(within(apps).getAllByRole("button").map((button) => button.querySelector(".excluded-apps-chip__name")?.textContent)).toEqual(["KB Star Banking", "Safari"]);
    // Each site once; kbstar.com's rule covers obank.kbstar.com, so the subdomain is not offered on its own.
    expect(within(sites).getAllByRole("button").map((button) => button.querySelector(".excluded-apps-chip__name")?.textContent)).toEqual(["youtube.com", "kbstar.com"]);

    const search = screen.getByRole("searchbox", { name: SEARCH });
    fireEvent.change(search, { target: { value: "kb" } });
    expect(within(picker).getAllByRole("button").map((button) => button.querySelector(".excluded-apps-chip__name")?.textContent)).toEqual(["KB Star Banking", "kbstar.com", "Add app “kb”"]);

    // With two matches Enter waits for a pick instead of saving "kb" as an app name.
    fireEvent.keyDown(search, { key: "Enter" });
    expect(save).not.toHaveBeenCalled();

    // A prefix that leaves one match takes that match rather than adding the text as a new name.
    fireEvent.change(search, { target: { value: "saf" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "com.apple.Safari", name: "Safari", bundleId: "com.apple.Safari", source: "user", kind: "app" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("clears the text with Escape, closes on a second Escape or a click elsewhere, and keeps the list in place", async () => {
    vi.mocked(trackerClient.getExcludedApps).mockResolvedValue([bankSite]);
    vi.mocked(trackerClient.searchClassificationRuleCandidates).mockResolvedValue([siteCandidate("youtube.com", 600)]);
    render(<ExclusionSettingsRows />);
    const search = await screen.findByRole("searchbox", { name: SEARCH });
    // Focus alone does not open the panel, so tabbing through Settings stays quiet.
    search.focus();
    expect(screen.queryByRole("region", { name: PICKER })).toBeNull();
    fireEvent.change(search, { target: { value: "you" } });
    expect(await screen.findByRole("region", { name: PICKER })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveProperty("value", "");
    expect(screen.getByRole("region", { name: PICKER })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: PICKER })).toBeNull());
    expect(search.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(search);
    expect(await screen.findByRole("region", { name: PICKER })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("region", { name: PICKER })).toBeNull());
    expect(screen.getByText("kbstar.com")).toBeTruthy();
  });
});
