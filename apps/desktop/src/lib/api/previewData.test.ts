// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldUsePreviewData } from "./previewData";

describe("previewData", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("uses the Drifty preview env flag", () => {
    vi.stubEnv("VITE_DRIFTY_PREVIEW", "1");
    expect(shouldUsePreviewData()).toBe(true);
  });

  it("keeps the legacy dtime preview env flag as a fallback", () => {
    vi.stubEnv("VITE_DTIME_PREVIEW", "1");
    expect(shouldUsePreviewData()).toBe(true);
  });

  it("uses Drifty query and storage keys while migrating legacy storage", () => {
    window.history.replaceState(null, "", "/?driftyPreview=1");
    expect(shouldUsePreviewData()).toBe(true);

    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("dtime.preview", "1");
    expect(shouldUsePreviewData()).toBe(true);
    expect(window.localStorage.getItem("drifty.preview")).toBe("1");
  });
});
