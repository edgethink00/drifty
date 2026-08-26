import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { classificationActivityLabel, classificationSourceLabel, windowTitleMatchesSiteTitle } from "./classificationViewData";

function segment(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "seg-1",
    startedAt: "2026-06-10T17:20:40+00:00",
    endedAt: "2026-06-10T17:20:46+00:00",
    durationSeconds: 6,
    appName: "Google Chrome",
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("classificationSourceLabel", () => {
  it("labels predefined, keyword, and custom rule sources distinctly", () => {
    expect(classificationSourceLabel("domain-db")).toBe("Predefined");
    expect(classificationSourceLabel("app-db")).toBe("Predefined");
    expect(classificationSourceLabel("youtube")).toBe("Predefined");
    expect(classificationSourceLabel("context")).toBe("Keyword rule");
    expect(classificationSourceLabel("rule")).toBe("Custom rule");
  });

  it("labels fresh AI and fingerprint-cache reuse separately", () => {
    expect(classificationSourceLabel("llm", true)).toBe("AI");
    expect(classificationSourceLabel("llm", true, true)).toBe("AI cache");
    expect(classificationSourceLabel(null, true, true)).toBe("AI cache");
    expect(classificationSourceLabel("unknown")).toBe("Not classified yet");
  });
});

describe("classificationActivityLabel", () => {
  it("keeps the cleaned window title when it matches the captured tab", () => {
    const label = classificationActivityLabel(segment({
      browserName: "Google Chrome",
      windowTitle: "[ENGSUB] Cartoon Pals ep1 - YouTube - 오디오 재생 - 메모리 사용량 많음 - 940MB - Chrome - Alex",
      siteDomain: "youtube.com",
      siteTitle: "[ENGSUB] Cartoon Pals ep1 - YouTube",
    }));

    expect(label).toBe("[ENGSUB] Cartoon Pals ep1");
  });

  it("falls back to the site title when the window title belongs to another window", () => {
    const label = classificationActivityLabel(segment({
      browserName: "Google Chrome",
      windowTitle: "[ENGSUB] Cartoon Pals ep1 - YouTube - 오디오 재생 - Chrome - Alex",
      siteDomain: "newtab",
      siteTitle: "새 탭",
      siteUrl: "chrome://newtab/",
    }));

    expect(label).toBe("새 탭");
  });

  it("uses the window title when no site context exists", () => {
    const label = classificationActivityLabel(segment({
      appName: "Notes",
      windowTitle: "Meeting notes",
    }));

    expect(label).toBe("Meeting notes");
  });

  it("falls back to domain and app name when titles are missing", () => {
    expect(classificationActivityLabel(segment({ siteDomain: "example.com" }))).toBe("example.com");
    expect(classificationActivityLabel(segment({}))).toBe("Google Chrome");
  });
});

describe("windowTitleMatchesSiteTitle", () => {
  it("accepts window titles that extend the tab title with browser badges", () => {
    expect(windowTitleMatchesSiteTitle(
      "Video - YouTube - 오디오 재생 - Chrome - Alex",
      "Video - YouTube",
      "Video",
    )).toBe(true);
  });

  it("accepts site titles that extend the stable window title", () => {
    expect(windowTitleMatchesSiteTitle(
      "Video - YouTube - Chrome - Alex",
      "Video - YouTube",
      "Video - YouTube",
    )).toBe(true);
  });

  it("rejects unrelated window and site titles", () => {
    expect(windowTitleMatchesSiteTitle(
      "Video - YouTube - Chrome - Alex",
      "새 탭",
      "Video",
    )).toBe(false);
  });

  it("treats missing titles as compatible", () => {
    expect(windowTitleMatchesSiteTitle("", "새 탭", null)).toBe(true);
    expect(windowTitleMatchesSiteTitle("Video", "", null)).toBe(true);
  });
});
