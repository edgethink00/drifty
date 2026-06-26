// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, relaunchMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  relaunchMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));

import { POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY } from "./updatePolicy";
import { DeveloperPreReleaseUpdateRow } from "./DeveloperPreReleaseUpdateRow";

describe("DeveloperPreReleaseUpdateRow", () => {
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
    relaunchMock.mockResolvedValue(undefined);
  });

  it("checks the developer pre-release updater command", async () => {
    render(<DeveloperPreReleaseUpdateRow />);

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_check_pre_release_update"));
    expect((await screen.findByRole("status")).textContent).toMatch(/no pre-release update is available/i);
  });

  it("shows an unpublished manifest state when the pre-release channel has no release JSON", async () => {
    invokeMock.mockRejectedValue("Could not fetch a valid release JSON from the remote");
    render(<DeveloperPreReleaseUpdateRow />);

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/no pre-release manifest is published yet/i);
    expect(screen.queryByText(/pre-release update check failed/i)).toBeNull();
  });

  it("opens the native update prompt and installs an available pre-release update when confirmed", async () => {
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
      if (command === "update_prompt_show_native") {
        return { autoInstallFutureUpdates: false, confirmed: true };
      }
      if (command === "developer_install_pre_release_update") return true;
      return null;
    });
    render(<DeveloperPreReleaseUpdateRow />);

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));
    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_prompt_show_native", {
      autoInstallFutureUpdates: false,
      urgent: false,
      version: "1.0.15",
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_install_pre_release_update"));
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
  });

  it("keeps an available pre-release update installable when the native prompt is dismissed", async () => {
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
      if (command === "update_prompt_show_native") {
        return { autoInstallFutureUpdates: false, confirmed: false };
      }
      if (command === "developer_install_pre_release_update") return true;
      return null;
    });
    render(<DeveloperPreReleaseUpdateRow />);

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));
    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_prompt_show_native", {
      autoInstallFutureUpdates: false,
      urgent: false,
      version: "1.0.15",
    }));
    expect(invokeMock).not.toHaveBeenCalledWith("developer_install_pre_release_update");

    const updateGroup = screen.getByRole("group", { name: /^Pre-release update$/i });
    fireEvent.click(within(updateGroup).getByRole("button", { name: /^Install and restart$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_install_pre_release_update"));
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
  });

  it("keeps the native pre-release prompt single-shot under React StrictMode", async () => {
    let resolveNativePrompt: ((value: { autoInstallFutureUpdates: boolean; confirmed: boolean }) => void) | null = null;
    const nativePrompt = new Promise<{ autoInstallFutureUpdates: boolean; confirmed: boolean }>((resolve) => {
      resolveNativePrompt = resolve;
    });
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
      if (command === "update_prompt_show_native") return await nativePrompt;
      if (command === "developer_install_pre_release_update") return true;
      return null;
    });
    render(
      <StrictMode>
        <DeveloperPreReleaseUpdateRow />
      </StrictMode>
    );

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));
    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();
    await waitFor(() => expect(nativePromptInvokeCount()).toBe(1));

    act(() => resolveNativePrompt?.({ autoInstallFutureUpdates: false, confirmed: false }));

    await waitFor(() => expect(nativePromptInvokeCount()).toBe(1));
    expect(invokeMock).not.toHaveBeenCalledWith("developer_install_pre_release_update");
  });

  it("disables the check outside the desktop runtime", () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");

    render(<DeveloperPreReleaseUpdateRow />);

    const button = screen.getByRole("button", { name: /^Check pre-release$/i });
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/desktop runtime/i);
  });
});

function nativePromptInvokeCount(): number {
  return invokeMock.mock.calls.filter(([command]) => command === "update_prompt_show_native").length;
}
