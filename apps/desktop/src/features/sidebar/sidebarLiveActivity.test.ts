import type { CurrentActivitySnapshot } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { resolveSidebarLiveActivityLabels } from "./sidebarLiveActivity";

const snapshot = { appName: "Google Chrome", siteDomain: "drifty.so", siteTitle: "Drifty" } as CurrentActivitySnapshot;
const base = { pendingAppLabel: "No activity", fallbackAppLabel: "Code" };

describe("resolveSidebarLiveActivityLabels", () => {
  it("names the live snapshot once it has arrived", () => {
    expect(resolveSidebarLiveActivityLabels({ ...base, running: true, snapshot, awaitingFirstSnapshot: false }))
      .toEqual({ appLabel: "Google Chrome", siteLabel: "drifty.so" });
  });

  it("keeps the pre-load placeholder until the first snapshot arrives, not the day's top app", () => {
    expect(resolveSidebarLiveActivityLabels({ ...base, running: true, snapshot: null, awaitingFirstSnapshot: true }))
      .toEqual({ appLabel: "No activity", siteLabel: null });
  });

  it("keeps the existing fallback once the snapshot request has settled empty", () => {
    expect(resolveSidebarLiveActivityLabels({ ...base, running: true, snapshot: null, awaitingFirstSnapshot: false }))
      .toEqual({ appLabel: "Code", siteLabel: null });
  });

  it("uses the fallback without a site while tracking is paused", () => {
    for (const awaitingFirstSnapshot of [true, false]) {
      expect(resolveSidebarLiveActivityLabels({ ...base, running: false, snapshot, awaitingFirstSnapshot }))
        .toEqual({ appLabel: "Code", siteLabel: null });
    }
  });
});
