import type { UpdatePolicy } from "./updatePolicy";

type AvailableUpdateDialogUpdate = {
  body?: string | null;
  date?: string | null;
  version: string;
};

export type AvailableUpdateDialogProps = {
  autoInstallFutureUpdates: boolean;
  policy: UpdatePolicy | null;
  update: AvailableUpdateDialogUpdate;
  updaterChecking: boolean;
  updaterError: string | null;
  updaterInstalling: boolean;
  onAutoInstallFutureUpdatesChange: (enabled: boolean) => void;
  onDismiss: () => void;
  onInstall: () => void;
};

export function AvailableUpdateDialog({
  autoInstallFutureUpdates,
  policy,
  update,
  updaterChecking,
  updaterError,
  updaterInstalling,
  onAutoInstallFutureUpdatesChange,
  onDismiss,
  onInstall,
}: AvailableUpdateDialogProps) {
  return (
    <div className="auth-modal__overlay" onClick={onDismiss}>
      <section className="auth-modal profile-modal update-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="available-update-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="available-update-title" className="update-dialog-title">Drifty {update.version} is available</h2>
        {update.date ? <p className="capture-recency">Published {new Date(update.date).toLocaleString()}</p> : null}
        {policy?.urgency === "urgent" ? <p className="capture-recency">Urgent update</p> : null}
        {policy?.message ? <p className="profile-modal__bio">{policy.message}</p> : null}
        <section className="update-dialog-summary" aria-label="Change summary">
          <div className="update-dialog-summary__label">Change summary</div>
          <p className="update-dialog-summary__body">{update.body?.trim() || "No release notes were provided."}</p>
        </section>
        {updaterError ? <p className="capture-recency capture-recency--error" role="status">{updaterError}</p> : null}
        <label className="update-dialog-checkbox">
          <input
            className="update-dialog-checkbox__input"
            type="checkbox"
            checked={autoInstallFutureUpdates}
            onChange={(event) => onAutoInstallFutureUpdatesChange(event.target.checked)}
          />
          <span className="update-dialog-checkbox__label">Automatically install and restart future updates</span>
        </label>
        <div className="profile-editor-modal__actions">
          <button type="button" className="ghost-button" onClick={onDismiss} disabled={updaterInstalling}>Not now</button>
          <button type="button" className="settings-btn" onClick={onInstall} disabled={updaterChecking || updaterInstalling}>{updaterInstalling ? "Installing..." : "Install and restart"}</button>
        </div>
      </section>
    </div>
  );
}
