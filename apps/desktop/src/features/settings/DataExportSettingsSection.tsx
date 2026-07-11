type DataExportSettingsSectionProps = {
  readonly databasePath: string | null | undefined;
  readonly todaySessionCount: number;
};

export function DataExportSettingsSection({ databasePath, todaySessionCount }: DataExportSettingsSectionProps) {
  const { t } = useLocalization();
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>{t("settings.section.data")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.database")}</div>
          </div>
          <div className="ctrl ctrl--value">{databasePath ?? t("settings.data.unknown")}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.sessions")}</div>
          </div>
          <div className="ctrl ctrl--value">{t("settings.data.sessionsToday", { count: todaySessionCount })}</div>
        </div>
      </div>
      <div className="settings-block">
        <h3>{t("settings.data.export")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.exportSessions")}</div>
            <div className="desc">{t("settings.data.exportDescription")}</div>
          </div>
          <div className="ctrl"><button type="button" className="settings-btn">{t("settings.data.downloadCsv")}</button></div>
        </div>
      </div>
    </div>
  );
}
import { useLocalization } from "../localization/LocalizationContext";
