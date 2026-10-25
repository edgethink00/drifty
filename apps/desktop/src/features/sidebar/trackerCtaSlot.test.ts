import { describe, expect, it } from "vitest";
import { resolveTrackerCtaSlot } from "./trackerCtaSlot";

describe("tracker sidebar card", () => {
  it("asks for disk space in red, ahead of AI and billing cards", () => {
    expect(resolveTrackerCtaSlot({ attention: "storage", running: true, trackingPaused: false, pausePending: false })).toEqual({
      kind: "tracker",
      direction: "forward",
      titleEmphasisCount: null,
      tone: "tracker",
      alert: "critical",
      titleKey: "tracker.storageLow",
      copyKey: "sidebar.cta.tracker.storageDetail",
      actionLabelKey: "sidebar.cta.tracker.storageAction",
      disabled: false,
    });
  });

  it("stays quiet while recording needs nothing", () => {
    expect(resolveTrackerCtaSlot({ attention: null, running: true, trackingPaused: false, pausePending: false })).toBeNull();
  });
});

