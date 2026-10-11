// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

vi.mock("../../lib/api/startupSettingsClient", () => ({
  startupSettingsClient: { isAvailable: () => false, isOpenAtLoginEnabled: vi.fn(), setOpenAtLoginEnabled: vi.fn() },
}));

import { GeneralSettingsSection } from "./GeneralSettingsSection";

function renderGeneral(language: "en" | "ko", hostPlatform: "macos" | "windows" = "macos") {
  return render(
    <LocalizationTestProvider language={language}>
      <GeneralSettingsSection
        backgroundUpdatesEnabled
        backgroundUpdatesSupported
        hostPlatform={hostPlatform}
        startOfDayValue="240"
        startOfWeek="monday"
        updaterChecking={false}
        updaterError={null}
        updaterInstalling={false}
        updaterMessage={null}
        onBackgroundUpdatesEnabledChange={vi.fn()}
        onCheckForUpdates={vi.fn()}
        onStartOfDayChange={vi.fn()}
        onStartOfWeekChange={vi.fn()}
      />
    </LocalizationTestProvider>,
  );
}

describe("GeneralSettingsSection", () => {
  afterEach(cleanup);

  it("keeps the day boundary setting without a duplicate read-only time zone row", () => {
    renderGeneral("en");
    expect(screen.getByRole("combobox", { name: "New day begins at" })).toBeTruthy();
    expect(document.querySelector('[data-setting-id="settings.general.timeZone"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
  });

  it("keeps Windows and Korean day-boundary controls", () => {
    renderGeneral("en", "windows");
    expect(screen.getByRole("combobox", { name: "New day begins at" })).toBeTruthy();
    cleanup();
    renderGeneral("ko");
    expect(document.querySelector('[data-setting-id="settings.general.startOfDay"]')).toBeTruthy();
    expect(screen.queryByText("시간대")).toBeNull();
  });
});
