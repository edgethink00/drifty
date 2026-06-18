import type { ActivitySegment, AppIconMap, AppIdentity } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { collectMissingAppIconRequests, mergeAppIconResults } from "./appIconRequests";

function segment(input: { readonly appName: string; readonly bundleId?: string | null }): ActivitySegment {
  return {
    id: `${input.bundleId ?? input.appName}:1`,
    appName: input.appName,
    bundleId: input.bundleId ?? null,
    startedAt: "2026-04-06T09:00:00.000Z",
    endedAt: "2026-04-06T09:05:00.000Z",
    durationSeconds: 300,
    platform: "macos",
    source: "nsworkspace",
  };
}

describe("appIconRequests", () => {
  it("skips app icon requests for already cached icon and null entries", () => {
    // Given: current icon state already knows Code and already tried Notes.
    const segments = [
      segment({ appName: "Code", bundleId: "com.example.code" }),
      segment({ appName: "Notes", bundleId: null }),
      segment({ appName: "Slack", bundleId: "com.tinyspeck.slackmacgap" }),
      segment({ appName: "Slack", bundleId: "com.tinyspeck.slackmacgap" }),
    ];
    const currentIcons: AppIconMap = {
      "com.example.code": "data:image/png;base64,code",
      Notes: null,
    };

    // When: missing icon identities are collected for a refresh.
    const requests = collectMissingAppIconRequests(segments, currentIcons);

    // Then: only uncached unique identities are requested.
    expect(requests).toEqual([
      { appName: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
    ]);
  });

  it("stores resolved app icon results under both bundle and app name keys", () => {
    // Given: the native response only contains the bundle key.
    const currentIcons: AppIconMap = { Existing: "data:image/png;base64,old" };
    const identities: AppIdentity[] = [
      { appName: "Code", bundleId: "com.example.code" },
      { appName: "Unknown", bundleId: "com.example.unknown" },
    ];
    const resolvedIcons: AppIconMap = {
      "com.example.code": "data:image/png;base64,code",
    };

    // When: resolved icons are merged into the renderer cache.
    const merged = mergeAppIconResults(currentIcons, identities, resolvedIcons);

    // Then: successful and missing lookups are both cached for later refreshes.
    expect(merged).toEqual({
      Existing: "data:image/png;base64,old",
      "com.example.code": "data:image/png;base64,code",
      Code: "data:image/png;base64,code",
      "com.example.unknown": null,
      Unknown: null,
    });
  });
});
