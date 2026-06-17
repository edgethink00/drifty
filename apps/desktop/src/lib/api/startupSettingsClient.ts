import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const startupSettingsClient = {
  isAvailable() {
    return isTauriRuntime();
  },
  async isOpenAtLoginEnabled() {
    if (!isTauriRuntime()) return false;
    return isEnabled();
  },
  async setOpenAtLoginEnabled(enabled: boolean) {
    if (!isTauriRuntime()) return false;
    if (enabled) await enable();
    else await disable();
    return true;
  },
};
