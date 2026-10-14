import { useCallback, useEffect, useState } from "react";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyThemeToDocument,
  resolveInitialThemePreference,
  resolveSystemTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemePreference,
} from "./settingsStorage";

const THEME_PREFERENCE_CHANGED = "drifty-theme-preference-change";

/** Keep the saved choice separate from the two palettes consumed by renderers. */
export function useAppTheme(previewTheme?: ThemeMode) {
  const [themePreference, updatePreference] = useState(resolveInitialThemePreference);
  const [systemTheme, updateSystemTheme] = useState(resolveSystemTheme);
  const theme = previewTheme ?? (themePreference === "system" ? systemTheme : themePreference);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    updatePreference(preference);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Session choice still works. */ }
    window.dispatchEvent(new CustomEvent(THEME_PREFERENCE_CHANGED, { detail: preference }));
  }, []);

  // Native state also reaches windows whose WebView storage notifications lag.
  const syncNativeTheme = useCallback((resolved: ThemeMode, followSystem = false) => {
    updatePreference(followSystem ? "system" : resolved);
    if (followSystem) updateSystemTheme(resolved);
  }, []);

  useEffect(() => {
    const refreshSystem = () => updateSystemTheme(resolveSystemTheme());
    const refreshPreference = (event?: Event) => {
      const choice: unknown = event instanceof CustomEvent ? event.detail : undefined;
      updatePreference(choice === "light" || choice === "dark" || choice === "system"
        ? choice : resolveInitialThemePreference());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) refreshPreference();
    };
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener?.("change", refreshSystem);
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_PREFERENCE_CHANGED, refreshPreference);
    window.addEventListener("focus", refreshSystem);
    document.addEventListener("visibilitychange", refreshSystem);
    refreshSystem();

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window) {
      void Promise.resolve().then(() => getCurrentWindow().onThemeChanged(({ payload }) => {
        if (!disposed) updateSystemTheme(payload);
      })).then((cleanup) => {
        if (disposed) cleanupTauriEventListener(cleanup);
        else unlisten = cleanup;
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
      media?.removeEventListener?.("change", refreshSystem);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_PREFERENCE_CHANGED, refreshPreference);
      window.removeEventListener("focus", refreshSystem);
      document.removeEventListener("visibilitychange", refreshSystem);
    };
  }, []);

  useEffect(() => { applyThemeToDocument(theme); }, [theme]);

  return { theme, themePreference, setThemePreference, syncNativeTheme };
}
