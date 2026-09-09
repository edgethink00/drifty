// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => false,
}));
import { acquireUpdateOperation } from "./versionSwitchState";
import { POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY } from "./updatePolicy";
import { useDeveloperPreReleaseUpdateController } from "./useDeveloperPreReleaseUpdateController";

describe("useDeveloperPreReleaseUpdateController", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValue({
      available: false,
      currentVersion: "1.0.14",
      version: null,
      date: null,
      body: null,
    });
  });

  it("checks the developer pre-release updater command", async () => {
    render(<LatestBuildControllerHarness />);

    fireEvent.click(screen.getByRole("button", { name: /^Check latest build$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_check_pre_release_update"));
    expect((await screen.findByRole("status")).textContent).toMatch(/no pre-release update is available/i);
  });

  it("shows an unpublished manifest state when the pre-release channel has no release JSON", async () => {
    invokeMock.mockRejectedValue("Could not fetch a valid release JSON from the remote");
    render(<LatestBuildControllerHarness />);

    fireEvent.click(screen.getByRole("button", { name: /^Check latest build$/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/no pre-release manifest is published yet/i);
    expect(screen.queryByText(/pre-release update check failed/i)).toBeNull();
  });

  it("exposes an available pre-release update for the App-level prompt", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "developer_check_pre_release_update") {
        return {
          available: true,
          currentVersion: "1.0.14",
          version: "1.0.15",
          date: "2026-06-23T10:00:00Z",
          body: "Developer validation build.",
        };
      }
      return null;
    });
    render(<LatestBuildControllerHarness />);

    fireEvent.click(screen.getByRole("button", { name: /^Check latest build$/i }));

    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();
    expect(screen.getByTestId("prompt-version").textContent).toBe("1.0.15");
    const installButton = screen.getByRole("button", { name: /^Install latest build$/i });
    if (!(installButton instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
    expect(installButton.disabled).toBe(false);
  });

  it("installs an available pre-release update and marks the relaunch focus flag", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "developer_check_pre_release_update") {
        return {
          available: true,
          currentVersion: "1.0.14",
          version: "1.0.15",
          date: "2026-06-23T10:00:00Z",
          body: "Developer validation build.",
        };
      }
      if (command === "developer_install_pre_release_update") return true;
      return null;
    });
    render(<LatestBuildControllerHarness />);

    fireEvent.click(screen.getByRole("button", { name: /^Check latest build$/i }));
    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Install latest build$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_install_pre_release_update"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update"));
    expect(window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
  });

  it("blocks prerelease installation while another channel owns the installer, then allows retry", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "developer_check_pre_release_update") return { available: true, currentVersion: "1.0.14", version: "1.0.15", date: null, body: null };
      return command === "developer_install_pre_release_update" ? true : null;
    });
    render(<LatestBuildControllerHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Check latest build$/i }));
    await screen.findByText(/drifty 1\.0\.15 pre-release is available/i);
    const release = acquireUpdateOperation();
    expect(release).not.toBeNull();
    try {
      fireEvent.click(screen.getByRole("button", { name: /^Install latest build$/i }));
      expect(invokeMock).not.toHaveBeenCalledWith("developer_install_pre_release_update");
    } finally { release?.(); }
    fireEvent.click(screen.getByRole("button", { name: /^Install latest build$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update"));
    expect(invokeMock.mock.calls.filter(([command]) => command === "developer_install_pre_release_update")).toHaveLength(1);
  });

  it("disables latest-build checks outside the desktop runtime", () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");

    render(<LatestBuildControllerHarness />);

    const button = screen.getByRole("button", { name: /^Check latest build$/i });
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/desktop runtime/i);
  });
});

function LatestBuildControllerHarness() {
  const controller = useDeveloperPreReleaseUpdateController();

  return (
    <div>
      <button
        type="button"
        onClick={() => void controller.checkLatestBuild()}
        disabled={!controller.updaterAvailable || controller.busy}
      >
        Check latest build
      </button>
      <button
        type="button"
        onClick={() => void controller.installLatestBuild()}
        disabled={!controller.canInstallPreReleaseUpdate || controller.busy}
      >
        Install latest build
      </button>
      {controller.promptUpdate?.version ? <p data-testid="prompt-version">{controller.promptUpdate.version}</p> : null}
      {controller.message ? <p role="status">{controller.message}</p> : null}
      {controller.error ? <p role="status">{controller.error}</p> : null}
    </div>
  );
}
