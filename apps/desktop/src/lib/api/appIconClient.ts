import { invoke } from "@tauri-apps/api/core";

/** Keep in step with `AppIconVariant` in src-tauri/src/commands/app_icon.rs. */
export const APP_ICON_VARIANT_IDS = [
  "classic", "midnight", "plum", "flow", "retro", "peek", "omega", "window", "cat-ivory", "cat-charcoal", "cat-plum",
] as const;
export type AppIconVariantId = (typeof APP_ICON_VARIANT_IDS)[number];
export const DEFAULT_APP_ICON_VARIANT: AppIconVariantId = "classic";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isAppIconVariantId(value: unknown): value is AppIconVariantId {
  return typeof value === "string" && (APP_ICON_VARIANT_IDS as readonly string[]).includes(value);
}

/** The Dock icon saved on this Mac. Outside the desktop app there is only the default. */
export async function getAppIconVariant(): Promise<AppIconVariantId> {
  if (!isTauriRuntime()) return DEFAULT_APP_ICON_VARIANT;
  const id = await invoke<string>("app_icon_get");
  return isAppIconVariantId(id) ? id : DEFAULT_APP_ICON_VARIANT;
}

/** Saves the choice on this Mac and swaps the running Dock icon. */
export async function setAppIconVariant(variant: AppIconVariantId): Promise<AppIconVariantId> {
  if (!isTauriRuntime()) return variant;
  const id = await invoke<string>("app_icon_set", { variant });
  return isAppIconVariantId(id) ? id : variant;
}

/**
 * Shows an icon in the Dock without saving it, for trying a locked Pro icon
 * on; null puts the saved icon back. Quitting always ends a preview.
 */
export async function previewAppIcon(variant: AppIconVariantId | null): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<string>("app_icon_preview", { variant });
}
