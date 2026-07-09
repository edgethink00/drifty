import { Toggle } from "../../components/Toggle";

type DevSettingsDeviceSyncBlockProps = {
  readonly deviceSyncPreviewEnabled: boolean;
  readonly onDeviceSyncPreviewEnabledChange: (enabled: boolean) => void;
};

export function DevSettingsDeviceSyncBlock({
  deviceSyncPreviewEnabled,
  onDeviceSyncPreviewEnabledChange,
}: DevSettingsDeviceSyncBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Device sync (preview)</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Enable device sync preview</div>
          <div className="desc">
            Show the Device sync section in Account settings. Sync itself still requires the
            per-Mac opt-in toggle there plus a signed-in paid account. Turning this off hides
            the section and immediately pauses any sync that was running.
          </div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={deviceSyncPreviewEnabled}
            onChange={onDeviceSyncPreviewEnabledChange}
            ariaLabel="Toggle device sync preview"
          />
        </div>
      </div>
    </div>
  );
}
