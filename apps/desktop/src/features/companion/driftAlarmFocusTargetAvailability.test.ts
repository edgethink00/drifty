import { describe, expect, it, vi } from "vitest";

import type { DriftAlarmFocusTarget } from "./driftAlarmEvent";
import { resolvePostCloseFocusTargets } from "./driftAlarmFocusTargetAvailability";

const appTarget: DriftAlarmFocusTarget = {
  targetId: "app:code",
  label: "Code",
  detail: "Editor",
  appName: "Code",
  bundleId: "com.microsoft.VSCode",
  browserName: null,
  siteDomain: null,
  siteTitle: null,
  siteUrl: null,
  iconSrc: null,
};

const browserTarget: DriftAlarmFocusTarget = {
  targetId: "site:example",
  label: "Example",
  detail: "example.com",
  appName: "Microsoft Edge",
  bundleId: "msedge.exe",
  browserName: "Microsoft Edge",
  siteDomain: "example.com",
  siteTitle: "Example",
  siteUrl: "https://example.com/",
  iconSrc: null,
};

describe("resolvePostCloseFocusTargets", () => {
  it("uses the synchronous supported-target filter on Windows", async () => {
    const resolver = vi.fn(async () => [appTarget, browserTarget]);

    await expect(resolvePostCloseFocusTargets([appTarget, browserTarget], "windows", resolver))
      .resolves.toEqual([appTarget]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("keeps the native browser availability lookup on macOS", async () => {
    const resolver = vi.fn(async () => [appTarget, browserTarget]);

    await expect(resolvePostCloseFocusTargets([appTarget, browserTarget], "macos", resolver))
      .resolves.toEqual([appTarget, browserTarget]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith([appTarget, browserTarget]);
  });
});
