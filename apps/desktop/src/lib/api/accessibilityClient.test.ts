// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectHostPlatform } from "./accessibilityClient";

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setTauriPlatform(platform: string) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
}

afterEach(() => {
  vi.unstubAllEnvs();
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
