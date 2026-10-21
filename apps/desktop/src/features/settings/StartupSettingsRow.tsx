import { useEffect, useState } from "react";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { reportStartupRegistration } from "../../lib/analytics/startupEnvironment";
import { toErrorMessage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { Toggle } from "../../components/Toggle";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { SettingsRowDescription } from "./SettingsRowDescription";

type StartupSettingsStatus = "loading" | "ready" | "saving" | "unavailable";

export function StartupSettingsRow() {
  const { t } = useLocalization();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<StartupSettingsStatus>(() => (
    startupSettingsClient.isAvailable() ? "loading" : "unavailable"
  ));
  const [error, setError] = useState<DescribedActionError | null>(null);

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
        setError(describeActionError(toErrorMessage(nextError), t("settings.general.startupUnavailable")));
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
      setError(describeActionError(toErrorMessage(nextError), t("settings.general.startupFailed")));
    }
  }

  const disabled = status === "loading" || status === "saving" || status === "unavailable";

  return (
    <div data-setting-id="settings.general.openAtLogin" className="settings-row">
      <div>
        <div className="lbl">{t("settings.general.openAtLogin")}</div>
        <SettingsRowDescription
          description={t("settings.general.openAtLoginDescription")}
          notice={error ? <>{error.message}{error.detail ? <span className="sr-only"> {error.detail}</span> : null}</> : null}
          noticeRole="status"
          noticeTitle={error?.detail ?? undefined}
        />
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
