import { useCallback, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/formatting";
import {
  checkDeveloperPreReleaseUpdate,
  installAndRelaunchDeveloperPreReleaseUpdate,
  isDeveloperPreReleaseUpdaterAvailable,
  type DeveloperPreReleaseUpdate,
} from "./preReleaseUpdaterClient";
export type PreReleaseUpdateStatus = "idle" | "checking" | "available" | "none" | "installing" | "installed" | "unavailable" | "error";

export type DeveloperPreReleaseUpdateController = {
  readonly busy: boolean;
  readonly canInstallPreReleaseUpdate: boolean;
  readonly error: string | null;
  readonly hasPreReleaseUpdate: boolean;
  readonly message: string | null;
  readonly promptUpdate: DeveloperPreReleaseUpdate | null;
  readonly status: PreReleaseUpdateStatus;
  readonly update: DeveloperPreReleaseUpdate | null;
  readonly updaterAvailable: boolean;
  readonly checkLatestBuild: () => Promise<void>;
  readonly dismissPrompt: () => void;
  readonly installLatestBuild: () => Promise<void>;
};

const MISSING_PRE_RELEASE_MANIFEST_ERROR = "Could not fetch a valid release JSON from the remote";
const MISSING_PRE_RELEASE_MANIFEST_MESSAGE = "No pre-release manifest is published yet.";
const DESKTOP_RUNTIME_MESSAGE = "Pre-release updates are available only inside the desktop runtime.";

function initialStatus(): PreReleaseUpdateStatus {
  return isDeveloperPreReleaseUpdaterAvailable() ? "idle" : "unavailable";
}

export function useDeveloperPreReleaseUpdateController(): DeveloperPreReleaseUpdateController {
  const statusInitialValue = initialStatus();
  const [status, setStatusState] = useState<PreReleaseUpdateStatus>(statusInitialValue);
  const [update, setUpdateState] = useState<DeveloperPreReleaseUpdate | null>(null);
  const [message, setMessage] = useState<string | null>(() => (
    statusInitialValue === "unavailable" ? DESKTOP_RUNTIME_MESSAGE : null
  ));
  const [error, setError] = useState<string | null>(null);
  const [promptedUpdateVersion, setPromptedUpdateVersion] = useState<string | null>(null);
  const statusRef = useRef(statusInitialValue);
  const updateRef = useRef<DeveloperPreReleaseUpdate | null>(null);

  const setStatus = useCallback((nextStatus: PreReleaseUpdateStatus) => {
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
  }, []);

  const setUpdate = useCallback((nextUpdate: DeveloperPreReleaseUpdate | null) => {
    updateRef.current = nextUpdate;
    setUpdateState(nextUpdate);
  }, []);

  const checkLatestBuild = useCallback(async () => {
    if (isBusyStatus(statusRef.current) || statusRef.current === "unavailable") return;

    setStatus("checking");
    setMessage(null);
    setError(null);
    setPromptedUpdateVersion(null);

    try {
      const nextUpdate = await checkDeveloperPreReleaseUpdate();
      if (!nextUpdate) {
        setUpdate(null);
        setStatus("unavailable");
        setMessage(DESKTOP_RUNTIME_MESSAGE);
        setPromptedUpdateVersion(null);
        return;
      }

      setUpdate(nextUpdate);
      if (nextUpdate.available && nextUpdate.version) {
        setStatus("available");
        setMessage(`Drifty ${nextUpdate.version} pre-release is available.`);
        setPromptedUpdateVersion(nextUpdate.version);
        return;
      }

      setStatus("none");
      setMessage(`No pre-release update is available. Current version ${nextUpdate.currentVersion}.`);
      setPromptedUpdateVersion(null);
    } catch (nextError) {
      const errorMessage = nextError instanceof Error ? nextError.message : toErrorMessage(nextError);
      setUpdate(null);
      setPromptedUpdateVersion(null);
      if (isMissingPreReleaseManifestError(errorMessage)) {
        setStatus("none");
        setMessage(MISSING_PRE_RELEASE_MANIFEST_MESSAGE);
        return;
      }

      setStatus("error");
      setError(`Pre-release update check failed: ${errorMessage}`);
    }
  }, [setStatus, setUpdate]);

  const installLatestBuild = useCallback(async () => {
    const currentUpdate = updateRef.current;
    if (isBusyStatus(statusRef.current) || currentUpdate?.available !== true) return;

    setStatus("installing");
    setError(null);
    setPromptedUpdateVersion(null);

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
  }, [setStatus, setUpdate]);

  const dismissPrompt = useCallback(() => setPromptedUpdateVersion(null), []);

  return useMemo(() => {
    const updaterAvailable = status !== "unavailable";
    const busy = isBusyStatus(status);
    const hasPreReleaseUpdate = update?.available === true;
    const canInstallPreReleaseUpdate = status === "available" && hasPreReleaseUpdate;
    const promptUpdate = update?.available === true && update.version === promptedUpdateVersion ? update : null;

    return {
      busy,
      canInstallPreReleaseUpdate,
      error,
      hasPreReleaseUpdate,
      message,
      promptUpdate,
      status,
      update,
      updaterAvailable,
      checkLatestBuild,
      dismissPrompt,
      installLatestBuild,
    };
  }, [
    checkLatestBuild,
    dismissPrompt,
    error,
    installLatestBuild,
    message,
    promptedUpdateVersion,
    status,
    update,
  ]);
}

function isBusyStatus(status: PreReleaseUpdateStatus): boolean {
  return status === "checking" || status === "installing";
}

function isMissingPreReleaseManifestError(errorMessage: string): boolean {
  return errorMessage.includes(MISSING_PRE_RELEASE_MANIFEST_ERROR);
}
