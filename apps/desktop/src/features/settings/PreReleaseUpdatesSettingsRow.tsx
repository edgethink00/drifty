import { buildLatestBuildStatusNotice } from "../updates/AppUpdateStatusNotice";
import type { PreReleaseUpdateStatus } from "../updates/useDeveloperPreReleaseUpdateController";

type PreReleaseUpdatesSettingsRowProps = {
  readonly status: PreReleaseUpdateStatus;
  readonly message: string | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly canInstallPreReleaseUpdate: boolean;
  readonly onCheckLatestBuild: () => void;
  readonly onInstallLatestBuild: () => void;
};

export function PreReleaseUpdatesSettingsRow({
  status,
  message,
  error,
  busy,
  canInstallPreReleaseUpdate,
  onCheckLatestBuild,
  onInstallLatestBuild,
}: PreReleaseUpdatesSettingsRowProps) {
  const notice = buildLatestBuildStatusNotice(status, message, error);
  const canCheckLatestBuild = status !== "unavailable" && !busy;
  const showInstallLatestBuild = canInstallPreReleaseUpdate || status === "installing";

  return (
    <div className="settings-row settings-row--fallback settings-row--pre-release-updates" role="group" aria-label="Pre-release updates">
      <div>
        <div className="lbl">Pre-release updates</div>
        <div className="desc">Checks the developer pre-release channel used by Developer &gt; Check Latest Build...</div>
        {notice ? (
          <p
            className={notice.role === "alert" ? "capture-recency capture-recency--error" : "capture-recency"}
            role={notice.role}
          >
            {notice.detail}
          </p>
        ) : null}
      </div>
      <div className="ctrl settings-row__actions settings-row__actions--wrap">
        <button
          type="button"
          className="settings-btn"
          onClick={onCheckLatestBuild}
          disabled={!canCheckLatestBuild}
        >
          {status === "checking" ? "Checking..." : "Check Latest Build"}
        </button>
        {showInstallLatestBuild ? (
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={onInstallLatestBuild}
            disabled={busy || !canInstallPreReleaseUpdate}
          >
            {status === "installing" ? "Installing..." : "Install Latest Build"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
