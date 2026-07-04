// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsStep } from "./components/steps/PermissionsStep";
import type { OnboardingStep } from "./onboardingFlow";
import { useSafariHistoryPermission } from "./useSafariHistoryPermission";

const { getBrowserHistoryEnvironment, previewBrowserHistoryImport, openFullDiskAccessSettingsPane } = vi.hoisted(
  () => ({
    getBrowserHistoryEnvironment: vi.fn(),
    previewBrowserHistoryImport: vi.fn(),
    openFullDiskAccessSettingsPane: vi.fn(),
  }),
);

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getBrowserHistoryEnvironment, previewBrowserHistoryImport },
}));
vi.mock("../../lib/api/systemSettingsClient", () => ({ openFullDiskAccessSettingsPane }));

function safariRow(): HTMLElement {
  const row = screen.getByText("Safari history").closest("li");
  if (!(row instanceof HTMLElement)) throw new Error("Safari history row was not rendered");
  return row;
}

function Harness({ step }: { readonly step: OnboardingStep }) {
  const safari = useSafariHistoryPermission(step);
  return (
    <PermissionsStep
      accessibilityGranted
      accessibilityReady
      notificationPermission="granted"
      notificationsReady
      openingSettingsPane={null}
      onNotificationPermission={() => {}}
      onRequestAccessibility={() => {}}
      safariHistoryShow={safari.show}
      safariHistoryReadable={safari.readable}
      safariHistoryOpening={safari.opening}
      onEnableSafariHistory={safari.onEnable}
    />
  );
}

describe("useSafariHistoryPermission (Safari onboarding row)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openFullDiskAccessSettingsPane.mockResolvedValue(true);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("hides the Safari row for a Chrome-default user with plenty of history", async () => {
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: false, defaultBrowserIsSafari: false });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 20 });

    render(<Harness step="permissions" />);

    // Let the mount-time evaluation resolve, then confirm the row never appears.
    await waitFor(() => expect(previewBrowserHistoryImport).toHaveBeenCalled());
    expect(screen.queryByText("Safari history")).toBeNull();
  });

  it("shows the Safari row for a Safari-default user", async () => {
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: false, defaultBrowserIsSafari: true });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 20 });

    render(<Harness step="permissions" />);

    await waitFor(() => expect(screen.getByText("Safari history")).toBeTruthy());
    expect(within(safariRow()).getByRole("button", { name: "Enable" })).toBeTruthy();
  });

  it("shows the Safari row when supported-browser history is nearly empty", async () => {
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: false, defaultBrowserIsSafari: false });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 2 });

    render(<Harness step="permissions" />);

    await waitFor(() => expect(screen.getByText("Safari history")).toBeTruthy());
  });

  it("still shows the row when the environment probe fails but the preview qualifies", async () => {
    // Regression: an older sidecar without get_browser_history_environment rejects the
    // probe; that must not hide the row for a user whose supported history is empty.
    getBrowserHistoryEnvironment.mockRejectedValue(new Error("tracker returned an error"));
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 0 });

    render(<Harness step="permissions" />);

    await waitFor(() => expect(screen.getByText("Safari history")).toBeTruthy());
  });

  it("flips the row to Enabled once the polled environment becomes readable", async () => {
    vi.useFakeTimers();
    getBrowserHistoryEnvironment
      .mockResolvedValueOnce({ safariHistoryReadable: false, defaultBrowserIsSafari: true })
      .mockResolvedValue({ safariHistoryReadable: true, defaultBrowserIsSafari: true });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 20 });

    render(<Harness step="permissions" />);

    // Flush the mount-time evaluation: row visible, not yet readable.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Safari history")).toBeTruthy();
    expect(within(safariRow()).getByRole("button", { name: "Enable" })).toBeTruthy();

    // Advance one poll tick; the environment now reports readable.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(within(safariRow()).getByRole("button", { name: "Enabled" })).toBeTruthy();
  });
});
