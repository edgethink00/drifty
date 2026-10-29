import { useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import type { RecordingHealth, RecordingHealthKind, RecordingRecoveryAction } from "../ai-connection/recordingHealth";
import { useLocalization } from "../localization/LocalizationContext";

/** States the person should act on use the same amber cue as the AI status pill. */
const ATTENTION: ReadonlySet<RecordingHealthKind> = new Set(["permission", "degraded", "storage", "unknown"]);

/** Uses the same observation as the status bar; it never starts a second poller. */
export function DashboardRecordingGuidance({ health, fallback, onRecover, onOpenStorage }: {
  readonly health: RecordingHealth | null;
  readonly fallback: string;
  readonly onRecover?: (action: RecordingRecoveryAction) => Promise<void>;
  readonly onOpenStorage?: () => void;
}) {
  const { t } = useLocalization();
  const [busy, setBusy] = useState(false);
  if (!health || health.kind === "recording" || health.kind === "preview") return <p>{fallback}</p>;
  const action = health.action;
  const button = health.kind === "storage" && onOpenStorage
    ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onOpenStorage}>{t("settings.section.privacy")}</button>
    : action && onRecover ? (
      <button type="button" className="app-btn app-btn--secondary app-btn--compact" disabled={busy} aria-busy={busy} onClick={() => {
        setBusy(true);
        void onRecover(action).catch(() => undefined).finally(() => setBusy(false));
      }}><ActionLabel busy={busy}>{t(`ai.recovery.action.${action}`)}</ActionLabel></button>
    ) : null;
  return (
    <div className="dashboard-recording-guidance" data-tone={ATTENTION.has(health.kind) ? "attention" : "neutral"}>
      <span className="dashboard-recording-guidance__status">
        <span className="dashboard-recording-guidance__dot" aria-hidden="true" />
        {t(`ai.recovery.recording.${health.kind}`)}
      </span>
      {button}
    </div>
  );
}
