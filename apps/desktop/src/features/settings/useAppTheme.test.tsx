// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveInitialTheme, resolveInitialThemePreference, THEME_STORAGE_KEY, type ThemeMode } from "./settingsStorage";
import { useAppTheme } from "./useAppTheme";

const native = vi.hoisted(() => ({ listener: null as null | ((event: { payload: ThemeMode }) => void), cleanup: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onThemeChanged: (listener: typeof native.listener) => {
  native.listener = listener;
  return Promise.resolve(native.cleanup);
} }) }));

let dark = false;
let listeners: Set<() => void>;
beforeEach(() => {
  window.localStorage.clear();
  dark = false;
  listeners = new Set();
  native.cleanup.mockClear();
  vi.stubGlobal("matchMedia", () => ({ matches: dark,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function changeSystem(nextDark: boolean) {
  act(() => { dark = nextDark; listeners.forEach((listener) => listener()); });
}

describe("theme preference", () => {
  it("uses System only when there is no existing Light/Dark choice", () => {
    expect(resolveInitialThemePreference()).toBe("system");
    for (const saved of ["light", "dark"] as const) {
      window.localStorage.setItem(THEME_STORAGE_KEY, saved);
      expect(resolveInitialThemePreference()).toBe(saved);
      expect(resolveInitialTheme()).toBe(saved);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(saved);
    }
  });

  it("follows live OS changes without replacing System with a resolved palette", () => {
    dark = true;
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.theme).toBe("dark");
    act(() => result.current.setThemePreference("system"));
    changeSystem(false);
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("keeps explicit choices pinned and restores tracking when System is selected", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useAppTheme());
    changeSystem(false);
    expect(result.current.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    act(() => result.current.setThemePreference("system"));
    expect(result.current.theme).toBe("light");
    changeSystem(true);
    expect(result.current.theme).toBe("dark");
  });

  it("synchronizes other windows and refreshes the OS appearance after resume", () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(result.current.theme).toBe("dark");
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "system");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
      dark = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.themePreference).toBe("system");
    expect(result.current.theme).toBe("dark");
  });

  it("receives native theme changes and cleans up listeners, including late registration", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { result, unmount } = renderHook(() => useAppTheme());
    await act(async () => { await Promise.resolve(); });
    act(() => native.listener?.({ payload: "dark" }));
    expect(result.current.theme).toBe("dark");
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(native.cleanup).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    native.cleanup.mockClear();
    const late = renderHook(() => useAppTheme());
    late.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(native.cleanup).toHaveBeenCalledOnce();
  });

  it("continues with System when storage is unavailable and honors a session choice", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("blocked"); });
    expect(resolveInitialThemePreference()).toBe("system");
    const { result } = renderHook(() => useAppTheme());
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    act(() => result.current.setThemePreference("dark"));
    expect(result.current.theme).toBe("dark");
    blocked.mockRestore();
  });
});
