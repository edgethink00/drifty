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
