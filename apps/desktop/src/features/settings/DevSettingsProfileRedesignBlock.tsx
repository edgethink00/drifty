import { Toggle } from "../../components/Toggle";

type DevSettingsProfileRedesignBlockProps = {
  readonly profileRedesignEnabled: boolean;
  readonly onProfileRedesignEnabledChange: (enabled: boolean) => void;
};

export function DevSettingsProfileRedesignBlock({
  profileRedesignEnabled,
  onProfileRedesignEnabledChange,
}: DevSettingsProfileRedesignBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Profile redesign (preview)</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Enable profile redesign</div>
          <div className="desc">Render the redesigned public profile controls inside Leaderboard. Off by default -- the shipped layout stays unchanged until you turn this on.</div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={profileRedesignEnabled}
            onChange={onProfileRedesignEnabledChange}
            ariaLabel="Toggle profile redesign preview"
          />
        </div>
      </div>
    </div>
  );
}
