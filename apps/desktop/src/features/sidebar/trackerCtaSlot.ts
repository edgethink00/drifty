import type { AccountTrackerAttention } from "../auth/AccountMenu";
import type { SidebarCtaSlotState } from "./SidebarCtaSlot";

type ResolveTrackerCtaSlotInput = {
  readonly attention: AccountTrackerAttention | null;
  /** The tracker still reports recording (a pause that is not confirmed yet). */
  readonly running: boolean;
  readonly trackingPaused: boolean;
  readonly pausePending: boolean;
};

/**
 * Tracking that needs the user takes the sidebar's contextual card slot ahead
 * of every AI and billing state: those cards promise "activity tracking
 * continues", which is false while nothing is recorded. Paused is the user's
 * own choice, so it uses the calm gold tone; a failed start, setup or a disk
 * too full to save activity is red.
 */
export function resolveTrackerCtaSlot({
  attention,
  running,
  trackingPaused,
  pausePending,
}: ResolveTrackerCtaSlotInput): SidebarCtaSlotState | null {
  if (attention === null) return null;
  const base = { kind: "tracker", direction: "forward", titleEmphasisCount: null } as const;
  if (attention === "setup") {
    return {
      ...base,
      tone: "tracker",
      alert: "critical",
      titleKey: "tracker.setupNeeded",
      copyKey: "sidebar.cta.tracker.setupDetail",
      actionLabelKey: "sidebar.cta.tracker.setupAction",
      disabled: false,
    };
  }
  if (attention === "databaseUnavailable" || attention === "captureUnavailable") {
    return {
      ...base,
      tone: "tracker",
      alert: "critical",
      titleKey: attention === "captureUnavailable" ? "ai.recovery.recording.unknown" : "ai.recovery.recording.databaseUnavailable",
      copyKey: attention === "captureUnavailable" ? "dashboard.recordingNote.unknown" : "dashboard.recordingNote.databaseUnavailable",
      actionLabelKey: "ai.recovery.action.check",
      disabled: false,
    };
  }
  if (attention === "attention") {
    return {
      ...base,
      tone: "tracker",
      alert: "critical",
      titleKey: "tracker.needsAttention",
      copyKey: running ? "sidebar.cta.tracker.pauseUnconfirmedDetail" : "sidebar.cta.tracker.notStartedDetail",
      actionLabelKey: pausePending
        ? "tracker.pausing"
        : running
          ? "tracker.pause"
          : trackingPaused
            ? "tracker.resume"
            : "tracker.retry",
      disabled: pausePending,
    };
  }
  if (attention === "storage" || attention === "storageFull") {
    return {
      ...base,
      tone: "tracker",
      alert: "critical",
      titleKey: attention === "storageFull" ? "ai.recovery.recording.storageFull" : "tracker.storageLow",
      copyKey: attention === "storageFull" ? "dashboard.recordingNote.storageFull" : "sidebar.cta.tracker.storageDetail",
      actionLabelKey: "sidebar.cta.tracker.storageAction",
      disabled: false,
    };
  }
  return {
    ...base,
    tone: "paused",
    alert: null,
    titleKey: "tracker.trackingPaused",
    copyKey: "sidebar.cta.tracker.pausedDetail",
    actionLabelKey: "tracker.resume",
    disabled: false,
  };
}
