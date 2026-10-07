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

describe("GeneralSettingsSection time zone row", () => {
  afterEach(cleanup);

  it("shows the device time zone read-only with where to change it", () => {
    renderGeneral("en");
    const row = document.querySelector('[data-setting-id="settings.general.timeZone"]');
    expect(row?.textContent).toContain("Time zone");
    // The Vitest setup pins the process zone to Asia/Seoul.
    expect(row?.textContent).toMatch(/Asia\/Seoul · GMT\+9/);
    expect(row?.textContent).toContain("System Settings");
    expect(row?.querySelector("select, input, [role=combobox], [role=switch]")).toBeNull();
  });

  it("uses Windows wording on Windows and Korean copy in Korean", () => {
    renderGeneral("en", "windows");
    expect(document.querySelector('[data-setting-id="settings.general.timeZone"]')?.textContent).toContain("Time & language");
    cleanup();
    renderGeneral("ko");
    expect(screen.getByText("시간대")).toBeTruthy();
  });
});
