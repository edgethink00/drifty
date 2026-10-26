import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import type { ScreenContextClient } from "./screenContextClient";
import { ScreenReplayViewer } from "./ScreenReplayViewer";

/** The activity's saved screens, opened from its detail. */
export function ActivityScreenEvidenceModal({ client, selection, activityLabel, initialRecordId = null, onClose, onInvalidated }: {
  readonly client: ScreenContextClient;
  readonly selection: ActivityEvidenceSelection;
  readonly activityLabel: string;
  readonly initialRecordId?: string | null;
  readonly onClose: () => void;
  readonly onInvalidated: () => void;
}) {
  const separator = activityLabel.lastIndexOf(" · ");
  const title = separator > 0 ? activityLabel.slice(0, separator) : activityLabel;
  const subtitle = separator > 0 ? activityLabel.slice(separator + 3) : undefined;
  return <ScreenReplayViewer client={client} source={{ kind: "activity", selection }} title={title} subtitle={subtitle}
    initialRecordId={initialRecordId} onClose={onClose} onInvalidated={onInvalidated} />;
}
