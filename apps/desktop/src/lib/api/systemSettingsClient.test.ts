// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { openFullDiskAccessSettingsPane, openSystemSettingsPane } from "./systemSettingsClient";

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("system settings shortcuts", () => {
  it("asks the native side for the drag-to-grant guide only when requested", async () => {
    await openSystemSettingsPane("accessibility", { guide: true });
    await openFullDiskAccessSettingsPane({ guide: true });
    expect(invoke).toHaveBeenNthCalledWith(1, "system_open_settings_pane", { pane: "accessibility", guide: true });
    expect(invoke).toHaveBeenNthCalledWith(2, "system_open_settings_pane", { pane: "fullDiskAccess", guide: true });
  });

  it("keeps plain shortcuts free of the guide", async () => {
    await openSystemSettingsPane("accessibility");
    await openFullDiskAccessSettingsPane();
    expect(invoke).toHaveBeenNthCalledWith(1, "system_open_settings_pane", { pane: "accessibility" });
    expect(invoke).toHaveBeenNthCalledWith(2, "system_open_settings_pane", { pane: "fullDiskAccess" });
  });

  it("does nothing outside the desktop app", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    await expect(openSystemSettingsPane("screenRecording", { guide: true })).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
