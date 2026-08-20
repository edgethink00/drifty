import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Drive the onboarding window presentation. `active` hides the macOS traffic
 * lights so the flow reads as a clean window; `compact` additionally shrinks
 * and centers the window to the onboarding card size so the card becomes the
 * window itself. The prior window size is restored when onboarding exits.
 */
export async function setOnboardingWindowPresentation(active: boolean, compact: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("window_set_onboarding_presentation", { active, compact });
  return true;
}

/**
 * Dev-only before/after switch for the sidebar glass. `true` keeps the native
 * window material configured in tauri.conf.json (the shipping "after");
 * `false` removes it so the legacy CSS backdrop-filter, which the caller
 * re-enables via the data-legacy-shell-blur attribute, becomes the only blur
 * source (the flickering "before").
 *
 * Uses a custom Rust command because Tauri's own `clearEffects()` never
 * removes the effect view on macOS: its vibrancy module implements clearing
 * only for Windows. The initial window state always comes from
 * tauri.conf.json; this only overrides it for the current app run.
 */
export async function setMainWindowNativeBlur(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("window_set_native_shell_blur", { enabled });
  return true;
}

/**
 * Keep the window's macOS appearance in step with the app's own theme. The
 * native shell material renders in the window appearance, so a dark app on a
 * light system would otherwise get a light material under a dark tint and read
 * as a flat opaque panel instead of glass.
 */
export async function setMainWindowThemeAppearance(dark: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("window_set_theme_appearance", { dark });
  return true;
}
