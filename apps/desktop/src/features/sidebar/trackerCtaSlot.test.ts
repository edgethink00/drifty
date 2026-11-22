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

  it("offers a status check, never pause or restart, when a live process cannot save", () => {
    expect(resolveTrackerCtaSlot({ attention: "captureUnavailable", running: true, trackingPaused: false, pausePending: false }))
      .toMatchObject({ titleKey: "ai.recovery.recording.unknown", actionLabelKey: "ai.recovery.action.check", alert: "critical" });
  });

  it("stays quiet while recording needs nothing", () => {
    expect(resolveTrackerCtaSlot({ attention: null, running: true, trackingPaused: false, pausePending: false })).toBeNull();
  });

  it("shows a saved pause as the calm paused card", () => {
    expect(resolveTrackerCtaSlot({ attention: "paused", running: false, trackingPaused: true, pausePending: false }))
      .toMatchObject({ tone: "paused", alert: null, titleKey: "tracker.trackingPaused", actionLabelKey: "tracker.resume" });
  });

  it("asks to restart only a tracker that stopped without a pause", () => {
    expect(resolveTrackerCtaSlot({ attention: "attention", running: false, trackingPaused: false, pausePending: false }))
      .toMatchObject({ alert: "critical", copyKey: "sidebar.cta.tracker.notStartedDetail", actionLabelKey: "tracker.retry" });
  });
});

