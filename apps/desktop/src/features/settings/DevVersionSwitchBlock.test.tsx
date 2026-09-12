// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
let DevVersionSwitchBlock: typeof import("./DevVersionSwitchBlock").DevVersionSwitchBlock;
let acquireUpdateOperation: typeof import("../updates/versionSwitchState").acquireUpdateOperation;
const mock = vi.hoisted(() => ({ invoke: vi.fn(), available: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../updates/preReleaseUpdaterClient", () => ({ isDeveloperPreReleaseUpdaterAvailable: () => mock.available }));
const catalog = { currentVersion: "1.11.1", releases: [{ tag: "v1.10.0", version: "1.10.0", prerelease: false, publishedAt: null }, { tag: "v1.11.1", version: "1.11.1", prerelease: false, publishedAt: null }], hasMore: false };
beforeEach(async () => {
  vi.resetModules();
  // Preserve the renderer's React instance while resetting the process-local update store.
  vi.doMock("react", () => React);
  ({ DevVersionSwitchBlock } = await import("./DevVersionSwitchBlock"));
  ({ acquireUpdateOperation } = await import("../updates/versionSwitchState"));
  window.localStorage.clear(); mock.available = true; mock.invoke.mockReset();
});
afterEach(() => cleanup());
async function select() {
  fireEvent.click(screen.getByText("Load versions"));
  await screen.findByText("Current version: 1.11.1");
  fireEvent.change(screen.getByLabelText("Target version"), { target: { value: "v1.10.0" } });
  fireEvent.click(screen.getByText("Review switch"));
}
describe("Dev version switching", () => {
  it("requires explicit confirmation, pauses legacy scheduling, then installs the exact tag and restarts", async () => {
    mock.invoke.mockImplementation(async (command) => command === "developer_list_releases" ? catalog : command === "developer_install_release" ? { version: "1.10.0", backupPath: "/synthetic/backup.sqlite3" } : undefined);
    render(<DevVersionSwitchBlock />); await select();
    expect(mock.invoke).not.toHaveBeenCalledWith("developer_install_release", expect.anything());
    fireEvent.click(screen.getByText("Back up, install & restart"));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("app_restart_after_update", { silent: false }));
    expect(mock.invoke).toHaveBeenCalledWith("developer_install_release", { tag: "v1.10.0" });
    expect(Number(localStorage.getItem("drifty.updates.nextAutomaticCheckAt.v1"))).toBeGreaterThan(Date.now());
    expect(localStorage.getItem("drifty.updates.autoInstallFuture")).toBe("0");
    expect(localStorage.getItem("drifty.updates.backgroundApply.v2")).toBe("0");
  });
  it("does not restart when backup or installation fails and leaves a visible resume control", async () => {
    mock.invoke.mockImplementation(async (command) => { if (command === "developer_list_releases") return catalog; throw new Error("Backup failed"); });
    render(<DevVersionSwitchBlock />); await select();
    fireEvent.click(screen.getByText("Back up, install & restart"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backup failed");
    expect(mock.invoke.mock.calls.filter(([command]) => command === "app_restart_after_update")).toHaveLength(0);
    fireEvent.click(screen.getByText("Resume automatic checks"));
    expect(localStorage.getItem("drifty.updates.nextAutomaticCheckAt.v1")).toBeNull();
  });
  it("can retry restart without installing twice", async () => {
    mock.invoke.mockImplementation(async (command) => { if (command === "developer_list_releases") return catalog; if (command === "developer_install_release") return {version:"1.10.0",backupPath:null}; throw new Error("Restart refused"); });
    render(<DevVersionSwitchBlock />); await select(); fireEvent.click(screen.getByText("Back up, install & restart"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Version installed, but restart failed");
    cleanup(); render(<DevVersionSwitchBlock />);
    expect(screen.getByText("Load versions")).toBeDisabled();
    expect(acquireUpdateOperation()).toBeNull();
    fireEvent.click(screen.getByText("Restart Drifty"));
    await waitFor(() => expect(mock.invoke.mock.calls.filter(([c]) => c === "app_restart_after_update")).toHaveLength(2));
    expect(mock.invoke.mock.calls.filter(([c]) => c === "developer_install_release")).toHaveLength(1);
  });
  it("blocks competing updater operations", async () => {
    mock.invoke.mockResolvedValue(catalog); render(<DevVersionSwitchBlock />); await select();
    let release: (() => void) | null = null; act(() => { release = acquireUpdateOperation(); });
    expect(screen.getByText("Back up, install & restart")).toBeDisabled();
    act(() => release?.());
    expect(screen.getByText("Back up, install & restart")).not.toBeDisabled();
  });
  it("shows unavailable and network errors without claiming empty releases", async () => {
    mock.available = false; const view = render(<DevVersionSwitchBlock />);
    expect(screen.getByText("Load versions")).toBeDisabled(); view.unmount(); mock.available = true;
    mock.invoke.mockRejectedValue(new Error("Rate limited")); render(<DevVersionSwitchBlock />);
    fireEvent.click(screen.getByText("Load versions")); expect(await screen.findByRole("alert")).toHaveTextContent("Rate limited");
    expect(screen.queryByText("No compatible signed releases found.")).toBeNull();
  });
});

it("shows the native install restriction before pausing updates", async () => {
  mock.invoke.mockResolvedValue({ ...catalog, installUnavailableReason: "Use a packaged production app." });
  render(<DevVersionSwitchBlock />); await select();
  expect(screen.getByText("Use a packaged production app.")).toBeTruthy();
  expect(screen.getByText("Review switch")).toBeDisabled();
  expect(screen.queryByText("Back up, install & restart")).toBeNull();
  expect(localStorage.getItem("drifty.updates.nextAutomaticCheckAt.v1")).toBeNull();
});

it("refuses to replace the app if persisting the update pause fails", async () => {
  mock.invoke.mockResolvedValue(catalog);
  render(<DevVersionSwitchBlock />); await select();
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  try {
    fireEvent.click(screen.getByText("Back up, install & restart"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(mock.invoke.mock.calls.filter(([command]) => command === "developer_install_release")).toHaveLength(0);
    expect(mock.invoke.mock.calls.filter(([command]) => command === "app_restart_after_update")).toHaveLength(0);
    const release = acquireUpdateOperation();
    expect(release).not.toBeNull();
    act(() => release?.());
  } finally { storage.mockRestore(); }
});

it("blocks another switch across a settings remount while the native install is pending", async () => {
  let finish!: (value: { version: string; backupPath: null }) => void;
  mock.invoke.mockImplementation(async (command) => {
    if (command === "developer_list_releases") return catalog;
    if (command === "developer_install_release") return new Promise(resolve => { finish = resolve; });
  });
  const first = render(<DevVersionSwitchBlock />); await select();
  fireEvent.click(screen.getByText("Back up, install & restart"));
  first.unmount();
  render(<DevVersionSwitchBlock />);
  expect(screen.getByText("Load versions")).toBeDisabled();
  expect(acquireUpdateOperation()).toBeNull();
  await act(async () => { finish({ version: "1.10.0", backupPath: null }); });
  expect(screen.getByText("Restart Drifty")).toBeEnabled();
  expect(screen.getByText("Load versions")).toBeDisabled();
  expect(acquireUpdateOperation()).toBeNull();
  expect(mock.invoke.mock.calls.filter(([command]) => command === "developer_install_release")).toHaveLength(1);
});
