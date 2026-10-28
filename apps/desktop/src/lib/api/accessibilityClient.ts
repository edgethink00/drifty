import { invoke } from "@tauri-apps/api/core";
import { rememberMacosMajorVersion } from "./accessibilityPaneName";

export interface AccessibilityPermissionStatus {
  granted: boolean;
  required: boolean;
  platform: HostPlatform;
  /** The running macOS major version; null elsewhere or from older native builds. */
  macosMajorVersion?: number | null;
}

export type HostPlatform = "macos" | "windows" | "other";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function detectHostPlatform(): HostPlatform {
  const buildPlatform = import.meta.env.VITE_DRIFTY_HOST_PLATFORM;
  if (buildPlatform === "windows" || buildPlatform === "macos" || buildPlatform === "other") {
    return buildPlatform;
  }
  if (!isTauriRuntime() || typeof navigator === "undefined") return "macos";
  // WebView2 can expose an empty or reduced `navigator.platform`. Its user
  // agent still carries the host OS, so use both before the native permission
  // response arrives and replaces this optimistic value.
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "other";
}

function normalizeStatus(status: Record<string, unknown> | null): AccessibilityPermissionStatus {
  const platform = status?.platform === "windows" || status?.platform === "other"
    ? status.platform
    : "macos";
  return {
    granted: Boolean(status?.granted),
    // Older native builds predate this field and are macOS-only, where the
    // permission is required. Defaulting to true preserves that contract.
    required: status?.required === undefined ? true : Boolean(status.required),
    platform,
    macosMajorVersion: typeof status?.macosMajorVersion === "number" && Number.isInteger(status.macosMajorVersion)
      ? status.macosMajorVersion
      : null,
  };
}

async function invokeAccessibilityStatus(command: string): Promise<AccessibilityPermissionStatus> {
  if (!isTauriRuntime()) return { granted: false, required: true, platform: "macos" };
  const status = await invoke<Record<string, unknown>>(command);
  const normalized = normalizeStatus(status);
  rememberMacosMajorVersion(normalized.macosMajorVersion);
  return normalized;
}

export const accessibilityClient = {
  detectHostPlatform,
  getStatus() {
    return invokeAccessibilityStatus("accessibility_get_status");
  },
  requestAccess() {
    return invokeAccessibilityStatus("accessibility_request_access");
  },
};
