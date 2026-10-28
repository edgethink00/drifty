// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessibilityClient, detectHostPlatform } from "./accessibilityClient";
import { accessibilityPaneIsDeviceControl, resetReportedMacosMajorVersion } from "./accessibilityPaneName";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setTauriPlatform(platform: string) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
}

afterEach(() => {
  vi.unstubAllEnvs();
  invoke.mockReset();
  resetReportedMacosMajorVersion();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  if (originalPlatform) {
    Object.defineProperty(navigator, "platform", originalPlatform);
  } else {
    Reflect.deleteProperty(navigator, "platform");
  }
  if (originalUserAgent) {
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  } else {
    Reflect.deleteProperty(navigator, "userAgent");
  }
});

describe("detectHostPlatform", () => {
  it("uses the Tauri build platform before runtime globals are available", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");
    expect(detectHostPlatform()).toBe("windows");
  });

  it("detects Windows before the native permission command resolves", () => {
    setTauriPlatform("Win32");
    expect(detectHostPlatform()).toBe("windows");
  });

  it("keeps browser previews on the macOS product default", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    expect(detectHostPlatform()).toBe("macos");
  });

  it("detects Windows from the WebView user agent when navigator.platform is empty", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });

    expect(detectHostPlatform()).toBe("windows");
  });
});
describe("accessibility status", () => {
  it("carries the macOS major version and lets the UI name the page as System Settings does", async () => {
    setTauriPlatform("MacIntel");
    invoke.mockResolvedValue({ granted: false, required: true, platform: "macos", macosMajorVersion: 27 });
    const status = await accessibilityClient.getStatus();
    expect(status.macosMajorVersion).toBe(27);
    expect(accessibilityPaneIsDeviceControl(status.macosMajorVersion)).toBe(true);
  });

  it("treats an older native build without a version as unknown", async () => {
    setTauriPlatform("MacIntel");
    invoke.mockResolvedValue({ granted: true, required: true, platform: "macos" });
    expect((await accessibilityClient.getStatus()).macosMajorVersion).toBeNull();
  });
});
