// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("installs and relaunches an available pre-release update", async () => {
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
    render(<DeveloperPreReleaseUpdateRow />);

    fireEvent.click(screen.getByRole("button", { name: /^Check pre-release$/i }));
    expect(await screen.findByText(/drifty 1\.0\.15 pre-release is available/i)).toBeTruthy();

    const updateGroup = screen.getByRole("group", { name: /^Pre-release update$/i });
    fireEvent.click(within(updateGroup).getByRole("button", { name: /^Install and restart$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("developer_install_pre_release_update"));
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
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
