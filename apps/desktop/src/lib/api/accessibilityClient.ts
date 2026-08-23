import { invoke } from "@tauri-apps/api/core";

export interface AccessibilityPermissionStatus {
  granted: boolean;
  required: boolean;
  platform: HostPlatform;
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
  };
}

async function invokeAccessibilityStatus(command: string): Promise<AccessibilityPermissionStatus> {
  if (!isTauriRuntime()) return { granted: false, required: true, platform: "macos" };
  const status = await invoke<Record<string, unknown>>(command);
  return normalizeStatus(status);
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
