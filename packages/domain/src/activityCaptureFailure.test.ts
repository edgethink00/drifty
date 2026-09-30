import { describe, expect, it } from "vitest";
import { isFailedForegroundCaptureSegment, type ActivitySegment } from "./activity";

const captured = {
  platform: "windows",
  appName: "Unavailable",
  bundleId: null,
  source: "unknown",
} satisfies Pick<ActivitySegment, "platform" | "appName" | "bundleId" | "source">;

describe("legacy Windows failed foreground captures", () => {
  it.each(["unknown", "win32-foreground", "win32-foreground-untitled"] as const)(
    "excludes an Unavailable row without a process identity from %s",
    (source) => {
      expect(isFailedForegroundCaptureSegment({ ...captured, source })).toBe(true);
    },
  );

  it("preserves a real app identity even when its display name is Unavailable", () => {
    expect(isFailedForegroundCaptureSegment({
      ...captured,
      source: "win32-foreground",
      bundleId: "C:\\Apps\\Unavailable\\Unavailable.exe",
    })).toBe(false);
  });

  it("does not reinterpret manual or macOS activity as a Windows capture failure", () => {
    expect(isFailedForegroundCaptureSegment({ ...captured, source: "manual" })).toBe(false);
    expect(isFailedForegroundCaptureSegment({ ...captured, platform: "macos" })).toBe(false);
  });
});
