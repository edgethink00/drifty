import { BUILD_INFO } from "../../buildInfo";

export function SettingsBuildInfoRow() {
  return (
    <div className="settings-row settings-row--build-info">
      <div>
        <div className="lbl">Build</div>
        <div className="desc">Commit used for this app build.</div>
      </div>
      <div className="ctrl">
        <code className="settings-build-code" aria-label={`Build commit ${BUILD_INFO.commit}`} title={BUILD_INFO.commit}>
          {BUILD_INFO.shortCommit}
        </code>
      </div>
    </div>
  );
}
