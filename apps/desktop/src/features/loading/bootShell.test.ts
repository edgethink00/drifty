// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "../localization/languagePreference";
import {
  BOOT_SHELL_PREVIEW_DURATION_MS,
  BOOT_SHELL_PREVIEW_DURATION_SECONDS,
  hideBootShell,
  localizeBootShell,
  shouldDeferBootShellForNativeMaterial,
  showBootShellPreview,
} from "./bootShell";

describe("boot shell preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    document.body.innerHTML = `
      <div id="boot-shell" hidden aria-hidden="true" data-boot-preview="false">
        <span id="boot-status">Loading Drifty later…</span>
        <span id="boot-status-visible" style="animation: old-animation">drifty still loading…</span>
      </div>
    `;
  });

  afterEach(() => {
    hideBootShell();
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it.each([
    { preferred: "en-US", label: "Loading Drifty", status: "Loading Drifty…" },
    { preferred: "es-US", label: "Cargando Drifty", status: "Cargando Drifty…" },
    { preferred: "ko-KR", label: "Drifty 불러오는 중", status: "Drifty 불러오는 중…" },
    { preferred: "fr-ES", label: "Chargement de Drifty", status: "Chargement de Drifty…" },
  ])("uses the first device language on the boot shell for $preferred", ({ preferred, label, status }) => {
    const languagesSpy = vi.spyOn(window.navigator, "languages", "get").mockReturnValue([preferred]);
    try {
      localizeBootShell();
      expect(document.getElementById("boot-shell")?.getAttribute("aria-label")).toBe(label);
      expect(document.getElementById("boot-status")?.textContent).toBe(status);
    } finally {
      languagesSpy.mockRestore();
    }
  });

  it("keeps a manual choice on the boot shell above the device language", () => {
    const languagesSpy = vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["es-US"]);
    try {
      window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
      localizeBootShell();
      expect(document.getElementById("boot-status")?.textContent).toBe("Loading Drifty…");
      expect(document.getElementById("boot-status-visible")?.textContent).toBe("drifty loading…");
    } finally {
      languagesSpy.mockRestore();
    }
  });

  it("shows the real boot shell long enough to preview the delayed status and resets its copy", () => {
    expect(showBootShellPreview()).toBe(true);

    const shell = document.getElementById("boot-shell");
    expect(shell?.hidden).toBe(false);
    expect(shell?.getAttribute("aria-hidden")).toBeNull();
    expect(shell?.getAttribute("aria-busy")).toBe("true");
    expect(shell?.dataset.bootPreview).toBe("true");
    expect(document.documentElement.dataset.bootActive).toBe("true");
    expect(BOOT_SHELL_PREVIEW_DURATION_MS).toBe(7_000);
    expect(BOOT_SHELL_PREVIEW_DURATION_SECONDS).toBe(7);
    expect(document.getElementById("boot-status")?.textContent).toBe("Loading Drifty…");
    expect(document.getElementById("boot-status-visible")?.textContent).toBe("drifty loading…");
    expect(document.getElementById("boot-status-visible")?.style.animation).toBe("");

    vi.advanceTimersByTime(BOOT_SHELL_PREVIEW_DURATION_MS - 1);
    expect(shell?.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(shell?.hidden).toBe(true);
    expect(shell?.getAttribute("aria-hidden")).toBe("true");
    expect(shell?.getAttribute("aria-busy")).toBe("false");
    expect(shell?.dataset.bootPreview).toBeUndefined();
    expect(document.documentElement.dataset.bootActive).toBeUndefined();
  });

  it("restarts the seven-second window when preview is requested again", () => {
    showBootShellPreview();
    vi.advanceTimersByTime(4_000);
    showBootShellPreview();
    vi.advanceTimersByTime(4_000);

    expect(document.getElementById("boot-shell")?.hidden).toBe(false);

    vi.advanceTimersByTime(3_000);
    expect(document.getElementById("boot-shell")?.hidden).toBe(true);
  });

  it("does nothing when the boot shell is unavailable", () => {
    document.body.replaceChildren();

    expect(showBootShellPreview()).toBe(false);
  });

  it("keeps only the native Windows main window covered until its material is ready", () => {
    expect(shouldDeferBootShellForNativeMaterial("app", "windows")).toBe(true);
    expect(shouldDeferBootShellForNativeMaterial("app", "macos")).toBe(false);
    expect(shouldDeferBootShellForNativeMaterial("companion", "windows")).toBe(false);
  });
});
