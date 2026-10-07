import { useEffect, useState } from "react";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { reportStartupRegistration } from "../../lib/analytics/startupEnvironment";
import { toErrorMessage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { Toggle } from "../../components/Toggle";

type StartupSettingsStatus = "loading" | "ready" | "saving" | "unavailable";

export function StartupSettingsRow() {
  const { t } = useLocalization();
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
        setError(t("settings.general.startupUnavailable", { error: toErrorMessage(nextError) }));
      }
    }

    void loadStartupStatus();

    return () => {
      isCurrent = false;
    };
  }, [t]);

  async function handleChange(nextEnabled: boolean) {
    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setStatus("saving");
    setError(null);

    try {
      const result = await startupSettingsClient.setOpenAtLoginEnabled(nextEnabled);
      reportStartupRegistration({
        phase: "settings",
        requestedEnabled: nextEnabled,
        outcome: result,
      });
      setStatus(result.success ? "ready" : "unavailable");
      setEnabled(result.success && result.enabled);
    } catch (nextError) {
      reportStartupRegistration({
        phase: "settings",
        requestedEnabled: nextEnabled,
        outcome: null,
        failed: true,
      });
      setEnabled(previousEnabled);
      setStatus("ready");
      setError(t("settings.general.startupFailed", { error: toErrorMessage(nextError) }));
    }
  }

  const disabled = status === "loading" || status === "saving" || status === "unavailable";

  return (
    <div data-setting-id="settings.general.openAtLogin" className="settings-row">
      <div>
        <div className="lbl">{t("settings.general.openAtLogin")}</div>
        <div className="desc">{t("settings.general.openAtLoginDescription")}</div>
        {error ? <p className="capture-recency capture-recency--error" role="status">{error}</p> : null}
      </div>
      <div className="ctrl">
        <Toggle
          ariaLabel={t("settings.general.openAtLogin")}
          checked={enabled}
          disabled={disabled}
          onChange={(nextEnabled) => void handleChange(nextEnabled)}
        />
      </div>
    </div>
  );
}
