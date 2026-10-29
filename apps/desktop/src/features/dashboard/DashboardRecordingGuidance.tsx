import { useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import type { RecordingHealth, RecordingHealthKind, RecordingRecoveryAction } from "../ai-connection/recordingHealth";
import { useLocalization } from "../localization/LocalizationContext";

/** States the person should act on use the same amber cue as the AI status pill. */
const ATTENTION: ReadonlySet<RecordingHealthKind> = new Set(["permission", "degraded", "storage", "unknown"]);
/** States in which nothing is being recorded right now; the current-time line turns dashed. */
const NOT_RECORDING: ReadonlySet<RecordingHealthKind> = new Set(["paused", "pausing", "permission"]);
/** States whose one-line explanation says what happens next. */
const DETAIL = ["paused", "permission", "storage", "unknown", "idle", "suppressed"] as const;
type DetailKind = typeof DETAIL[number];
const hasDetail = (kind: RecordingHealthKind): kind is DetailKind => (DETAIL as readonly string[]).includes(kind);

/** Whether the guidance replaces the empty-day text (any state but a confirmed recording or a preview). */
export function recordingNeedsGuidance(health: RecordingHealth | null | undefined): health is RecordingHealth {
  return Boolean(health) && health!.kind !== "recording" && health!.kind !== "preview";
}

export function isRecordingStopped(health: RecordingHealth): boolean {
  return NOT_RECORDING.has(health.kind);
}

/**
 * Uses the same observation as the status bar; it never starts a second poller.
 * `below` is the one line under the hours-across chart; `now` is the entry the
 * hours-down Your Day places beside its current-time line, in the notes column.
 */
export function DashboardRecordingGuidance({ health, fallback, placement = "below", onRecover, onOpenStorage }: {
  readonly health: RecordingHealth | null;
  readonly fallback: string;
  readonly placement?: "below" | "now";
  readonly onRecover?: (action: RecordingRecoveryAction) => Promise<void>;
  readonly onOpenStorage?: () => void;
}) {
  const { t } = useLocalization();
  const [busy, setBusy] = useState(false);
  if (!recordingNeedsGuidance(health)) return placement === "now" ? null : <p>{fallback}</p>;
  const action = health.action;
  // Resuming uses the sidebar card's words, so the two buttons on screen read as one action.
  const actionLabel = action === "resume" ? t("tracker.resume") : action ? t(`ai.recovery.action.${action}`) : null;
  const button = health.kind === "storage" && onOpenStorage
    ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onOpenStorage}>{t("settings.section.privacy")}</button>
    : action && actionLabel && onRecover ? (
      <button type="button" className="app-btn app-btn--secondary app-btn--compact" disabled={busy} aria-busy={busy} onClick={() => {
        setBusy(true);
        void onRecover(action).catch(() => undefined).finally(() => setBusy(false));
      }}><ActionLabel busy={busy}>{actionLabel}</ActionLabel></button>
    ) : null;
  const status = (
    <span className="dashboard-recording-guidance__status">
      <span className="dashboard-recording-guidance__dot" aria-hidden="true" />
      {t(`ai.recovery.recording.${health.kind}`)}
    </span>
  );
  const tone = ATTENTION.has(health.kind) ? "attention" : "neutral";
  if (placement === "now") {
    return (
      <div className="dashboard-recording-guidance dashboard-recording-guidance--now" data-tone={tone} role="note">
        {status}
        {hasDetail(health.kind) ? <span className="dashboard-recording-guidance__detail">{t(`dashboard.recordingNote.${health.kind}`)}</span> : null}
        {button}
      </div>
    );
  }
  return (
    <div className="dashboard-recording-guidance" data-tone={tone}>
      {status}
      {button}
    </div>
  );
}
