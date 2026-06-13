// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewAppIcons, previewTimeline, shouldUsePreviewData } from "./previewData";

describe("previewData", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    vi.useRealTimers();
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

  it("uses varied week fixtures instead of repeating the same work blocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T18:40:00"));

    const week = previewTimeline({
      start: "2026-05-04T00:00:00",
      end: "2026-05-08T23:59:59",
    });
    const oldRepeatedBlocks = week.filter((segment) =>
      segment.appName === "Visual Studio Code"
      && segment.startedAt.endsWith("09:05:00")
      && segment.endedAt.endsWith("11:30:00")
    );
    const weekdayPlans = new Set(
      week
        .filter((segment) => segment.appName !== "Arc")
        .map((segment) => `${segment.startedAt.slice(0, 10)}:${segment.appName}:${segment.startedAt.slice(11, 16)}-${segment.endedAt.slice(11, 16)}:${segment.windowTitle ?? ""}`),
    );

    expect(oldRepeatedBlocks.length).toBeLessThan(2);
    expect(weekdayPlans.size).toBeGreaterThan(12);
  });

  it("returns real preview app icon references for native app identities", () => {
    const icons = previewAppIcons([
      { appName: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
      { appName: "Figma", bundleId: "com.figma.Desktop" },
      { appName: "Linear", bundleId: "com.linear" },
    ]);

    expect(icons["com.microsoft.VSCode"]).toContain("visual-studio-code");
    expect(icons.Figma).toContain("figma.com");
    expect(icons.Linear).toContain("linear");
  });
});
