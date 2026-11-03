import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import type { ScreenContextClient } from "./screenContextClient";
import { ScreenReplayViewer } from "./ScreenReplayViewer";

/** The activity's saved screens, opened from its detail. */
export function ActivityScreenEvidenceModal({ client, selection, activityLabel, initialRecordId = null, initialPlaying = false, onRecordChange, onClose, onInvalidated }: {
  readonly client: ScreenContextClient;
  readonly selection: ActivityEvidenceSelection;
  readonly activityLabel: string;
  readonly initialRecordId?: string | null;
  readonly initialPlaying?: boolean;
  readonly onRecordChange?: (recordId: string) => void;
  readonly onClose: () => void;
  readonly onInvalidated: () => void;
}) {
  const separator = activityLabel.lastIndexOf(" · ");
  const title = separator > 0 ? activityLabel.slice(0, separator) : activityLabel;
  const subtitle = separator > 0 ? activityLabel.slice(separator + 3) : undefined;
  return <ScreenReplayViewer client={client} source={{ kind: "activity", selection }} title={title} subtitle={subtitle}
    initialRecordId={initialRecordId} initialPlaying={initialPlaying} onRecordChange={onRecordChange} onClose={onClose} onInvalidated={onInvalidated} />;
}
