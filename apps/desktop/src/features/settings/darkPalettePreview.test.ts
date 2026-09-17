// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  DARK_PALETTE_PREVIEW_STORAGE_KEY,
  applyDarkPalettePreview,
  installDarkPalettePreviewStorageSync,
  persistDarkPalettePreview,
  resolveInitialDarkPalettePreview,
} from "./darkPalettePreview";

const DEV_MODE_STORAGE_KEY = "drifty.dev.mode";

describe("dark palette preview", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.darkPalettePreview;
  });

  it("persists and restores a valid preview", () => {
    persistDarkPalettePreview("v21");

    expect(window.localStorage.getItem(DARK_PALETTE_PREVIEW_STORAGE_KEY)).toBe("v21");
    expect(resolveInitialDarkPalettePreview()).toBe("v21");
  });

  it("falls back to the shipping palette for an unknown saved value", () => {
    window.localStorage.setItem(DARK_PALETTE_PREVIEW_STORAGE_KEY, "future-study");

    expect(resolveInitialDarkPalettePreview()).toBe("current");
  });

  it("resolves legacy v1 preview to current shipping palette", () => {
    window.localStorage.setItem(DARK_PALETTE_PREVIEW_STORAGE_KEY, "v1");

    expect(resolveInitialDarkPalettePreview()).toBe("current");
  });

  it("removes the preview when Current is selected or Dev mode is inactive", () => {
    const root = document.documentElement;

    applyDarkPalettePreview(root, "v21", true);
    expect(root.dataset.darkPalettePreview).toBe("v21");

    applyDarkPalettePreview(root, "current", true);
    expect(root.dataset.darkPalettePreview).toBeUndefined();

    applyDarkPalettePreview(root, "classic", true);
    applyDarkPalettePreview(root, "classic", false);
    expect(root.dataset.darkPalettePreview).toBeUndefined();
  });

  it("keeps secondary webviews synchronized with palette and Dev-mode storage", () => {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DARK_PALETTE_PREVIEW_STORAGE_KEY, "classic");
    const stopSync = installDarkPalettePreviewStorageSync(
      window,
      document.documentElement,
      true,
      DEV_MODE_STORAGE_KEY,
    );

    expect(document.documentElement.dataset.darkPalettePreview).toBe("classic");

    window.localStorage.setItem(DARK_PALETTE_PREVIEW_STORAGE_KEY, "v21");
    window.dispatchEvent(new StorageEvent("storage", {
      key: DARK_PALETTE_PREVIEW_STORAGE_KEY,
      newValue: "v21",
    }));
    expect(document.documentElement.dataset.darkPalettePreview).toBe("v21");

    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    window.dispatchEvent(new StorageEvent("storage", {
      key: DEV_MODE_STORAGE_KEY,
      newValue: "0",
    }));
    expect(document.documentElement.dataset.darkPalettePreview).toBeUndefined();

    stopSync();
  });
});
