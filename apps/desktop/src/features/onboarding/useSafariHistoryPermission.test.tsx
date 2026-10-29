// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingStep } from "./onboardingFlow";
import { resetSafariHistorySettingsPreview, useSafariHistoryPermission } from "./useSafariHistoryPermission";

const {
  detectHostPlatform,
  getBrowserHistoryEnvironment,
  previewBrowserHistoryImport,
  openFullDiskAccessSettingsPane,
} = vi.hoisted(
  () => ({
    detectHostPlatform: vi.fn(),
    getBrowserHistoryEnvironment: vi.fn(),
    previewBrowserHistoryImport: vi.fn(),
    openFullDiskAccessSettingsPane: vi.fn(),
  }),
);

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getBrowserHistoryEnvironment, previewBrowserHistoryImport },
}));
vi.mock("../../lib/api/accessibilityClient", () => ({
  accessibilityClient: { detectHostPlatform },
}));
vi.mock("../../lib/api/systemSettingsClient", () => ({ openFullDiskAccessSettingsPane }));

function safariRow(): HTMLElement {
  const row = screen.getByText("Safari history").closest("li");
  if (!(row instanceof HTMLElement)) throw new Error("Safari history row was not rendered");
  return row;
}

// Minimal render harness for the hook: mirrors the Safari row semantics of the
// onboarding permissions step (row shown when `show`, button label tracks state).
function Harness({ step, context }: { readonly step: OnboardingStep; readonly context?: "onboarding" | "settings" }) {
  const safari = useSafariHistoryPermission(step, { context });
  if (!safari.show) return null;
  return (
    <ul>
      <li>
        <span>Safari history</span>
        <button type="button" onClick={safari.onEnable} disabled={safari.opening || safari.readable}>
          {safari.readable ? "Enabled" : safari.opening ? "Opening…" : "Enable"}
        </button>
      </li>
    </ul>
  );
}

describe("useSafariHistoryPermission (Safari onboarding row)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSafariHistorySettingsPreview();
    detectHostPlatform.mockReturnValue("macos");
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

  it("never probes or shows Safari history on Windows", async () => {
    detectHostPlatform.mockReturnValue("windows");
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: false, defaultBrowserIsSafari: false });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 0 });

    render(<Harness step="permissions" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("Safari history")).toBeNull();
    expect(getBrowserHistoryEnvironment).not.toHaveBeenCalled();
    expect(previewBrowserHistoryImport).not.toHaveBeenCalled();
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

  it("in Settings, reuses one history preview per session and polls only after Enable", async () => {
    // Settings > General opens on every Settings visit, so it must not rescan
    // browser history or poll Full Disk Access just because the page is open.
    vi.useFakeTimers();
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: false, defaultBrowserIsSafari: true });
    previewBrowserHistoryImport.mockResolvedValue({ segmentCount: 20 });

    const first = render(<Harness step="permissions" context="settings" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Safari history")).toBeTruthy();
    const probesAfterMount = getBrowserHistoryEnvironment.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(getBrowserHistoryEnvironment).toHaveBeenCalledTimes(probesAfterMount);

    // Leaving and reopening General does not run a second preview.
    first.unmount();
    render(<Harness step="permissions" context="settings" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(previewBrowserHistoryImport).toHaveBeenCalledTimes(1);

    // Once the user asks to enable it, polling picks up the new grant.
    getBrowserHistoryEnvironment.mockResolvedValue({ safariHistoryReadable: true, defaultBrowserIsSafari: true });
    fireEvent.click(within(safariRow()).getByRole("button", { name: "Enable" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // The read above already listed Drifty (switched off), so the pane opens without the
    // drag-to-grant guide; turning on that switch is the step.
    expect(openFullDiskAccessSettingsPane).toHaveBeenCalledWith();
    expect(within(safariRow()).getByRole("button", { name: "Enabled" })).toBeTruthy();
  });
});
