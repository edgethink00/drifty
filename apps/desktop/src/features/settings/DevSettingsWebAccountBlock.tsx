import { Toggle } from "../../components/Toggle";

type DevSettingsWebAccountBlockProps = {
  readonly webAccountPreviewEnabled: boolean;
  readonly onWebAccountPreviewEnabledChange: (enabled: boolean) => void;
};

export function DevSettingsWebAccountBlock({
  webAccountPreviewEnabled,
  onWebAccountPreviewEnabledChange,
}: DevSettingsWebAccountBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Web account &amp; embed detail (preview)</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Enable web account &amp; embed detail</div>
          <div className="desc">
            Gates two preview features: (a) the optional detail-share toggles on your public focus card
            (category breakdown, hourly rhythm, top apps) on the Profile tab, and (b) periodic publishing
            of an aggregate-only activity summary (private to your account) that powers the drifty.so
            account dashboard. Off by default — nothing extra is published until you turn this on.
          </div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={webAccountPreviewEnabled}
            onChange={onWebAccountPreviewEnabledChange}
            ariaLabel="Toggle web account and embed detail preview"
          />
        </div>
      </div>
    </div>
  );
}
