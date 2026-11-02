import { useState } from "react";
import { PersonalApiSettingsBlock, type PersonalApiSettingsBlockProps } from "./PersonalApiSettingsBlock";

const PREVIEW_SYNC_DELAY_MS = 900;

/**
 * Browser preview only (personalApiPreview.ts): after the consent dialog the
 * fixture's sync turns on a moment later, as the app's would, so the turn-on
 * states in the block and the new-key dialog can be reviewed.
 */
export function PersonalApiPreviewSettingsBlock({
  preview,
  onOpenSyncSettings,
}: {
  readonly preview: Omit<PersonalApiSettingsBlockProps, "onOpenSyncSettings">;
  readonly onOpenSyncSettings: () => void;
}): JSX.Element {
  const [syncOn, setSyncOn] = useState(preview.deviceSyncEnabled);
  return (
    <PersonalApiSettingsBlock
      {...preview}
      deviceSyncEnabled={syncOn}
      onEnableDeviceSync={async () => {
        await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, PREVIEW_SYNC_DELAY_MS); });
        setSyncOn(true);
        return true;
      }}
      onOpenSyncSettings={onOpenSyncSettings}
    />
  );
}
