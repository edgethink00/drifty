import { useState } from "react";
import { toErrorMessage } from "../../lib/formatting";
import {
  checkDeveloperPreReleaseUpdate,
  installAndRelaunchDeveloperPreReleaseUpdate,
  isDeveloperPreReleaseUpdaterAvailable,
  type DeveloperPreReleaseUpdate,
} from "./preReleaseUpdaterClient";

type PreReleaseUpdateStatus = "idle" | "checking" | "available" | "none" | "installing" | "installed" | "unavailable" | "error";

const MISSING_PRE_RELEASE_MANIFEST_ERROR = "Could not fetch a valid release JSON from the remote";
const MISSING_PRE_RELEASE_MANIFEST_MESSAGE = "No pre-release manifest is published yet.";

export function DeveloperPreReleaseUpdateRow() {
  const [status, setStatus] = useState<PreReleaseUpdateStatus>(() => (
    isDeveloperPreReleaseUpdaterAvailable() ? "idle" : "unavailable"
  ));
  const [update, setUpdate] = useState<DeveloperPreReleaseUpdate | null>(null);
  const [message, setMessage] = useState<string | null>(() => (
    isDeveloperPreReleaseUpdaterAvailable() ? null : "Pre-release updates are available only inside the desktop runtime."
  ));
  const [error, setError] = useState<string | null>(null);

  const updaterAvailable = status !== "unavailable";
  const busy = status === "checking" || status === "installing";
  const hasPreReleaseUpdate = update?.available === true;
  const canInstallPreReleaseUpdate = status === "available" && hasPreReleaseUpdate;

  async function handleCheckForPreRelease() {
    if (busy || !updaterAvailable) return;

    setStatus("checking");
    setMessage(null);
    setError(null);

    try {
      const nextUpdate = await checkDeveloperPreReleaseUpdate();
      if (!nextUpdate) {
        setUpdate(null);
        setStatus("unavailable");
        setMessage("Pre-release updates are available only inside the desktop runtime.");
        return;
      }

      setUpdate(nextUpdate);
      if (nextUpdate.available && nextUpdate.version) {
        setStatus("available");
        setMessage(`Drifty ${nextUpdate.version} pre-release is available.`);
        return;
      }

      setStatus("none");
      setMessage(`No pre-release update is available. Current version ${nextUpdate.currentVersion}.`);
    } catch (nextError) {
      const errorMessage = nextError instanceof Error ? nextError.message : toErrorMessage(nextError);
      setUpdate(null);
      if (isMissingPreReleaseManifestError(errorMessage)) {
        setStatus("none");
        setMessage(MISSING_PRE_RELEASE_MANIFEST_MESSAGE);
        return;
      }

      setStatus("error");
      setError(`Pre-release update check failed: ${errorMessage}`);
    }
  }

  async function handleInstallPreRelease() {
    if (busy || !canInstallPreReleaseUpdate) return;

    setStatus("installing");
    setError(null);

    try {
      const didInstall = await installAndRelaunchDeveloperPreReleaseUpdate();
      if (!didInstall) {
        setUpdate(null);
        setStatus("none");
        setMessage("No pre-release update was available at install time.");
        return;
      }

      setStatus("installed");
      setMessage("Pre-release update installed. Relaunching...");
    } catch (nextError) {
      const errorMessage = nextError instanceof Error ? nextError.message : toErrorMessage(nextError);
      setStatus("available");
      setError(`Pre-release update install failed: ${errorMessage}`);
    }
  }

  return (
    <div className="settings-row" role="group" aria-label="Pre-release update">
      <div>
        <div className="lbl">Pre-release update</div>
        <div className="desc">Checks the developer-only pre-release updater channel. General update checks stay on stable releases.</div>
        {update?.available && update.date ? <p className="capture-recency">Published {new Date(update.date).toLocaleString()}</p> : null}
        {message ? <p className="capture-recency" role="status">{message}</p> : null}
        {error ? <p className="capture-recency capture-recency--error" role="status">{error}</p> : null}
      </div>
      <div className="ctrl settings-row__actions">
        <button type="button" className="settings-btn" onClick={() => void handleCheckForPreRelease()} disabled={busy || !updaterAvailable}>
          {status === "checking" ? "Checking..." : "Check pre-release"}
        </button>
        {hasPreReleaseUpdate ? (
          <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handleInstallPreRelease()} disabled={busy}>
            {status === "installing" ? "Installing..." : "Install and restart"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function isMissingPreReleaseManifestError(errorMessage: string): boolean {
  return errorMessage.includes(MISSING_PRE_RELEASE_MANIFEST_ERROR);
}
