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

describe("GeneralSettingsSection manual update row", () => {
  afterEach(cleanup);

  function renderUpdates(overrides: Partial<{ updaterChecking: boolean; updaterError: string | null; updaterMessage: string | null }>) {
    return render(
      <LocalizationTestProvider language="en">
        <GeneralSettingsSection
          backgroundUpdatesEnabled
          backgroundUpdatesSupported
          currentVersion="1.12.3"
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
          {...overrides}
        />
      </LocalizationTestProvider>,
    );
  }

  function updateRowLines(): string[] {
    const row = document.querySelector('[data-setting-id="settings.general.manualUpdate"] > div:first-child') as HTMLElement;
    return Array.from(row.children).map((line) => line.textContent ?? "");
  }

  it("says Checking only inside the button while a manual check runs", () => {
    renderUpdates({ updaterChecking: true, updaterMessage: "Checking for updates..." });
    const button = screen.getByRole("button", { name: "Checking…" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    // The live region stays mounted but empty, so the result that replaces
    // its text later is announced.
    expect(screen.getByRole("status").textContent).toBe("");
    expect(updateRowLines()).toEqual(["Manual update check", "Drifty 1.12.3"]);
  });

  it("puts the result beside the version on the same line", () => {
    const view = renderUpdates({ updaterChecking: true, updaterMessage: "Checking for updates..." });
    const status = screen.getByRole("status");
    view.rerender(
      <LocalizationTestProvider language="en">
        <GeneralSettingsSection
          backgroundUpdatesEnabled
          backgroundUpdatesSupported
          currentVersion="1.12.3"
          startOfDayValue="240"
          startOfWeek="monday"
          updaterChecking={false}
          updaterError={null}
          updaterInstalling={false}
          updaterMessage="Drifty is up to date."
          onBackgroundUpdatesEnabledChange={vi.fn()}
          onCheckForUpdates={vi.fn()}
          onStartOfDayChange={vi.fn()}
          onStartOfWeekChange={vi.fn()}
        />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Drifty is up to date.");
    expect(status.closest(".settings-update-version")).toBeTruthy();
    expect(updateRowLines()).toHaveLength(2);
  });

  it("puts a short failure beside the version and keeps the updater's reason in the title", () => {
    const detail = "Update check failed: signed update metadata was unavailable after several retries.";
    renderUpdates({ updaterError: detail, updaterMessage: "Checking for updates..." });
    const status = screen.getByRole("status");
    // The visible line fits beside the version; the reason the line would cut
    // off is read out with it and shown on hover.
    expect(status.firstChild?.textContent).toBe("Update check failed");
    expect(status.querySelector(".sr-only")?.textContent).toBe(" signed update metadata was unavailable after several retries.");
    expect(status.classList.contains("settings-update-outcome--error")).toBe(true);
    expect(status.closest("[title]")?.getAttribute("title")).toBe("Update check failed\nsigned update metadata was unavailable after several retries.");
    expect(status.closest(".settings-update-version")).toBeTruthy();
    expect(updateRowLines()).toHaveLength(2);
  });
});

