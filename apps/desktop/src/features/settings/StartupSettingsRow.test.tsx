// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startupSettingsClient = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  isOpenAtLoginEnabled: vi.fn(),
  setOpenAtLoginEnabled: vi.fn(),
}));

vi.mock("../../lib/api/startupSettingsClient", () => ({ startupSettingsClient }));

import { StartupSettingsRow } from "./StartupSettingsRow";

function getStartupCheckbox(): HTMLInputElement {
  const checkbox = screen.getByRole("checkbox", { name: /open drifty at login/i });
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error("Open at login control must be a checkbox input");
  }
  return checkbox;
}

describe("StartupSettingsRow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    startupSettingsClient.isAvailable.mockReturnValue(true);
    startupSettingsClient.isOpenAtLoginEnabled.mockResolvedValue(false);
    startupSettingsClient.setOpenAtLoginEnabled.mockResolvedValue(true);
  });

  it("shows the saved login startup state when the native API is available", async () => {
    startupSettingsClient.isOpenAtLoginEnabled.mockResolvedValue(true);

    render(<StartupSettingsRow />);

    await screen.findByRole("checkbox", { name: /open drifty at login/i });
    const checkbox = getStartupCheckbox();

    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(startupSettingsClient.isOpenAtLoginEnabled).toHaveBeenCalledTimes(1);
  });

  it("enables login startup when the checkbox is checked", async () => {
    render(<StartupSettingsRow />);

    await screen.findByRole("checkbox", { name: /open drifty at login/i });
    const checkbox = getStartupCheckbox();
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);

    await waitFor(() => expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it("disables login startup when the checkbox is unchecked", async () => {
    startupSettingsClient.isOpenAtLoginEnabled.mockResolvedValue(true);

    render(<StartupSettingsRow />);

    await screen.findByRole("checkbox", { name: /open drifty at login/i });
    const checkbox = getStartupCheckbox();
    await waitFor(() => expect(checkbox.checked).toBe(true));
    fireEvent.click(checkbox);

    await waitFor(() => expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(checkbox.checked).toBe(false));
  });

  it("disables the control outside the Tauri runtime", async () => {
    startupSettingsClient.isAvailable.mockReturnValue(false);

    render(<StartupSettingsRow />);

    await screen.findByRole("checkbox", { name: /open drifty at login/i });
    const checkbox = getStartupCheckbox();

    expect(checkbox.disabled).toBe(true);
    expect(startupSettingsClient.isOpenAtLoginEnabled).not.toHaveBeenCalled();
  });
});
