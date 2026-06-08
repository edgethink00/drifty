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


  it("uses Drifty query and storage keys", () => {
    window.history.replaceState(null, "", "/?driftyPreview=1");
    expect(shouldUsePreviewData()).toBe(true);

    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("drifty.preview", "1");
    expect(shouldUsePreviewData()).toBe(true);
  });
});
