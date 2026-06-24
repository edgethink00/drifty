import { useEffect, useState } from "react";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { toErrorMessage } from "../../lib/formatting";

type StartupSettingsStatus = "loading" | "ready" | "saving" | "unavailable";

export function StartupSettingsRow() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<StartupSettingsStatus>(() => (
    startupSettingsClient.isAvailable() ? "loading" : "unavailable"
  ));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadStartupStatus() {
      if (!startupSettingsClient.isAvailable()) return;

      try {
        const nextEnabled = await startupSettingsClient.isOpenAtLoginEnabled();
        if (!isCurrent) return;
        setEnabled(nextEnabled);
        setStatus("ready");
        setError(null);
      } catch (nextError) {
        if (!isCurrent) return;
        setStatus("ready");
        setError(`Startup setting unavailable: ${toErrorMessage(nextError)}`);
      }
    }

    void loadStartupStatus();

    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleChange(nextEnabled: boolean) {
    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setStatus("saving");
    setError(null);

    try {
      const result = await startupSettingsClient.setOpenAtLoginEnabled(nextEnabled);
      setStatus(result.success ? "ready" : "unavailable");
      if (!result.success) setEnabled(false);
    } catch (nextError) {
      setEnabled(previousEnabled);
      setStatus("ready");
      setError(`Startup setting failed: ${toErrorMessage(nextError)}`);
    }
  }

  const disabled = status === "loading" || status === "saving" || status === "unavailable";

  return (
    <div className="settings-row">
      <label htmlFor="open-at-login">
        <div className="lbl">Open Drifty at login</div>
        <div className="desc">Start Drifty in the background when you sign in to your Mac.</div>
        {error ? <p className="capture-recency capture-recency--error" role="status">{error}</p> : null}
      </label>
      <div className="ctrl">
        <input
          id="open-at-login"
          className="drifty-checkbox"
          type="checkbox"
          aria-label="Open Drifty at login"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => void handleChange(event.target.checked)}
        />
      </div>
    </div>
  );
}
