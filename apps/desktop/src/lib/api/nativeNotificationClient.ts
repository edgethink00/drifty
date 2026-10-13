import { invoke } from "@tauri-apps/api/core";

/**
 * macOS notification permission and delivery through UNUserNotificationCenter
 * (src-tauri/src/commands/native_notifications.rs). On macOS 27 the
 * notification plugin's legacy path raises the system permission request
 * instead of showing the first notification and cannot say whether the user
 * allowed it; this path reads and requests the real permission.
 *
 * "unavailable" means Windows, a browser, or a Drifty process that does not
 * run from an app bundle (plain `tauri dev`); callers then use the plugin.
 */
export type NativeNotificationAuthorization = "authorized" | "denied" | "notDetermined" | "unavailable";
export type NativeNotificationSendOutcome = "sent" | "denied" | "notDetermined" | "unavailable";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function readNativeNotificationAuthorization(): Promise<NativeNotificationAuthorization> {
  if (!isTauriRuntime()) return "unavailable";
  try {
    return await invoke<NativeNotificationAuthorization>("native_notification_authorization");
  } catch {
    return "unavailable";
  }
}

/** Shows the macOS permission request when it has not been answered; otherwise returns the answer. */
export async function requestNativeNotificationAuthorization(): Promise<NativeNotificationAuthorization> {
  if (!isTauriRuntime()) return "unavailable";
  try {
    return await invoke<NativeNotificationAuthorization>("native_notification_request_authorization");
  } catch {
    return "unavailable";
  }
}

/**
 * Posts one notification, asking for permission first when macOS has not
 * asked yet. Rejects when macOS fails to accept it for another reason.
 */
export async function sendNativeNotification(notification: {
  readonly identifier: string;
  readonly title: string;
  readonly body: string;
}): Promise<NativeNotificationSendOutcome> {
  if (!isTauriRuntime()) return "unavailable";
  return invoke<NativeNotificationSendOutcome>("native_notification_send", { ...notification });
}

