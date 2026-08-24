import { describe, expect, it } from "vitest";
import { collectMissingSiteIconRequests, mergeSiteIconResults, normalizeSiteIconDomain } from "./siteIconRequests";
import type { ActivitySegment } from "@drifty/domain";

function segment(siteDomain: string | null): ActivitySegment {
  return {
    id: `seg-${siteDomain ?? "none"}`,
    appName: "Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: "",
    siteDomain,
    siteTitle: null,
    siteUrl: null,
    startedAt: "2026-08-25T09:00:00",
    endedAt: "2026-08-25T09:05:00",
    durationSeconds: 300,
    platform: "macos",
    source: "browser",
  } as unknown as ActivitySegment;
}

describe("normalizeSiteIconDomain", () => {
  it("keeps ordinary public domains and drops browser-internal values", () => {
    expect(normalizeSiteIconDomain("YouTube.com")).toBe("youtube.com");
    // Tracker rows carry these; none is a fetchable host.
    for (const value of ["newtab", "settings", "localhost", "127.0.0.1", "fjdhphbdlfjogobdofoaagnlnkoibdge"]) {
      expect(normalizeSiteIconDomain(value)).toBeNull();
    }
  });
});

describe("collectMissingSiteIconRequests", () => {
  it("asks only for domains with no entry yet", () => {
    const segments = [segment("youtube.com"), segment("github.com"), segment("newtab"), segment(null)];
    // A null entry is a resolved miss and must not be re-requested.
    const missing = collectMissingSiteIconRequests(segments, { "github.com": null });

    expect(missing).toEqual(["youtube.com"]);
  });
});

describe("mergeSiteIconResults", () => {
  it("records resolved icons and resolved misses", () => {
    const merged = mergeSiteIconResults({}, ["youtube.com", "nope.com"], {
      "youtube.com": "data:image/png;base64,yt",
      "nope.com": null,
    });

    expect(merged["youtube.com"]).toBe("data:image/png;base64,yt");
    expect(merged["nope.com"]).toBeNull();
  });

  it("leaves deferred domains unresolved so a later pass retries them", () => {
    // The native batch caps how many domains it fetches and omits the rest.
    const merged = mergeSiteIconResults({}, ["a.com", "b.com"], { "a.com": "data:image/png;base64,a" });

    expect(merged["a.com"]).toBe("data:image/png;base64,a");
    expect(Object.prototype.hasOwnProperty.call(merged, "b.com")).toBe(false);
    // Still requestable, which is the whole point.
    expect(collectMissingSiteIconRequests([segment("b.com")], merged)).toEqual(["b.com"]);
  });
});

