import { invoke } from "@tauri-apps/api/core";

export interface AccessibilityPermissionStatus {
  granted: boolean;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeStatus(status: Record<string, unknown> | null): AccessibilityPermissionStatus {
  return { granted: Boolean(status?.granted) };
}

async function invokeAccessibilityStatus(command: string): Promise<AccessibilityPermissionStatus> {
  if (!isTauriRuntime()) return { granted: false };
  const status = await invoke<Record<string, unknown>>(command);
  return normalizeStatus(status);
}

export const accessibilityClient = {
  getStatus() {
    return invokeAccessibilityStatus("accessibility_get_status");
  },
  requestAccess() {
    return invokeAccessibilityStatus("accessibility_request_access");
  },
};
