// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";

const mocks = vi.hoisted(() => ({
  authorization: vi.fn(),
  request: vi.fn(),
  enabled: vi.fn(),
  setEnabled: vi.fn(),
  openPane: vi.fn(),
}));

vi.mock("../calendar/macCalendarClient", () => ({
  getMacCalendarAuthorization: mocks.authorization,
  requestMacCalendarAccess: mocks.request,
  isMacCalendarEnabled: mocks.enabled,
  setMacCalendarEnabled: mocks.setEnabled,
}));
vi.mock("../../lib/api/systemSettingsClient", () => ({ openSystemSettingsPane: mocks.openPane }));

import { MacCalendarSettings } from "./MacCalendarSettings";

function renderSettings() {
  return render(
    <LocalizationTestProvider language="en">
      <MacCalendarSettings />
    </LocalizationTestProvider>,
  );
}

describe("MacCalendarSettings", () => {
  beforeEach(() => {
    mocks.authorization.mockReset().mockResolvedValue("notDetermined");
    mocks.request.mockReset().mockResolvedValue("granted");
    mocks.enabled.mockReset().mockReturnValue(false);
    mocks.setEnabled.mockReset();
    mocks.openPane.mockReset().mockResolvedValue(true);
  });

  afterEach(cleanup);

  it("asks macOS for access only when the person turns it on", async () => {
    renderSettings();
    const toggle = await screen.findByRole("switch", { name: "macOS Calendar" });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(true);

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("stays off and points to System Settings when access is refused", async () => {
    mocks.request.mockResolvedValue("denied");
    renderSettings();
    fireEvent.click(await screen.findByRole("switch", { name: "macOS Calendar" }));
    await screen.findByText(/Allow it in System Settings/u);
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("switch", { name: "macOS Calendar" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));
    expect(mocks.openPane).toHaveBeenCalledWith("calendars");
  });

  it("is hidden where EventKit is unavailable", async () => {
    mocks.authorization.mockResolvedValue("unsupported");
    const { container } = renderSettings();
    await waitFor(() => expect(mocks.authorization).toHaveBeenCalled());
    expect(container.querySelector('[data-setting-id="settings.macCalendar.enabled"]')).toBeNull();
  });
});
