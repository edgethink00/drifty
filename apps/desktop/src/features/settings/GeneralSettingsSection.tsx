import { Toggle } from "../../components/Toggle";
import { SettingsSelect } from "./SettingsSelect";
import { StartupSettingsRow } from "./StartupSettingsRow";
import type { StartOfWeek } from "./settingsStorage";
import {
  START_OF_DAY_OPTIONS,
} from "./settingsStorage";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { formatStartOfDayOptionLabel } from "../../lib/formatting";
import { localizeUpdateMessage } from "../localization/settingsMessageTranslations";

type GeneralSettingsSectionProps = {
  readonly autoInstallFutureUpdates: boolean;
  readonly startOfDayValue: string;
  readonly startOfWeek: StartOfWeek;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
  readonly onAutoInstallFutureUpdatesChange: (enabled: boolean) => void;
  readonly onCheckForUpdates: () => void;
  readonly onRequestAccessibility: () => void;
  readonly onStartOfDayChange: (value: string) => void;
  readonly onStartOfWeekChange: (value: StartOfWeek) => void;
};

export function GeneralSettingsSection({
  autoInstallFutureUpdates,
  startOfDayValue,
  startOfWeek,
  updaterChecking,
  updaterError,
  updaterInstalling,
  updaterMessage,
  onAutoInstallFutureUpdatesChange,
  onCheckForUpdates,
  onRequestAccessibility,
  onStartOfDayChange,
  onStartOfWeekChange,
}: GeneralSettingsSectionProps) {
  const { displayLanguage, effectiveLanguage, koreanPreviewEnabled, setDisplayLanguage, t } = useLocalization();
  const languageOptions = [
    { value: "en", label: t("common.english") },
    { value: "ko", label: t("common.korean") },
  ] satisfies ReadonlyArray<{ value: DisplayLanguage; label: string }>;
  const startOfWeekOptions = [
    { value: "monday", label: t("settings.weekday.monday") },
    { value: "sunday", label: t("settings.weekday.sunday") },
    { value: "saturday", label: t("settings.weekday.saturday") },
  ] satisfies ReadonlyArray<{ value: StartOfWeek; label: string }>;
  const startOfDayOptions = START_OF_DAY_OPTIONS.map((option) => ({
    ...option,
    label: formatStartOfDayOptionLabel(option.minutes, effectiveLanguage === "ko" ? "ko-KR" : "en-US"),
  }));

  return (
    <div className="settings-section settings-section--general">
      <div className="settings-block"><h3>{t("settings.section.general")}</h3>
        {koreanPreviewEnabled ? (
          <div className="settings-row settings-row--language-preview">
            <div>
              <div className="lbl">{t("settings.language.label")}</div>
              <div className="desc">{t("settings.language.description")}</div>
              <div className="desc">{t("settings.language.previewNote")}</div>
            </div>
            <div className="ctrl"><SettingsSelect ariaLabel={t("settings.language.label")} value={displayLanguage} options={languageOptions} onChange={setDisplayLanguage} /></div>
          </div>
        ) : null}
        <div className="settings-row"><label><div className="lbl">{t("settings.general.startOfDay")}</div><div className="desc">{t("settings.general.startOfDayDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfDay")} value={startOfDayValue} options={startOfDayOptions} onChange={onStartOfDayChange} /></div></div>
        <div className="settings-row"><label><div className="lbl">{t("settings.general.startOfWeek")}</div><div className="desc">{t("settings.general.startOfWeekDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfWeek")} value={startOfWeek} options={startOfWeekOptions} onChange={onStartOfWeekChange} /></div></div>
      </div>
      <div className="settings-block"><h3>{t("settings.general.startup")}</h3>
        <StartupSettingsRow />
      </div>
      <div className="settings-block"><h3>{t("settings.general.updates")}</h3>
        <div className="settings-row"><div><div className="lbl">{t("settings.general.autoUpdates")}</div><div className="desc">{t("settings.general.autoUpdatesDescription")}</div></div><div className="ctrl"><Toggle checked={autoInstallFutureUpdates} onChange={onAutoInstallFutureUpdatesChange} ariaLabel={t("settings.general.autoUpdates")} /></div></div>
        <div className="settings-row"><div><div className="lbl">{t("settings.general.manualUpdate")}</div><div className="desc">{t("settings.general.manualUpdateDescription")}</div>{updaterMessage ? <p className="capture-recency" role="status">{localizeUpdateMessage(updaterMessage, "status", effectiveLanguage, t)}</p> : null}{updaterError ? <p className="capture-recency capture-recency--error" role="alert">{localizeUpdateMessage(updaterError, "error", effectiveLanguage, t)}</p> : null}</div><div className="ctrl"><button type="button" className="settings-btn" onClick={onCheckForUpdates} disabled={updaterChecking || updaterInstalling}>{updaterChecking ? t("settings.general.checking") : t("settings.general.checkForUpdates")}</button></div></div>
      </div>
      <div className="settings-block"><h3>{t("settings.general.permissions")}</h3>
        <div className="settings-row"><div><div className="lbl">{t("settings.general.accessibility")}</div><div className="desc">{t("settings.general.accessibilityDescription")}</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={onRequestAccessibility}>{t("settings.general.grantAccessibility")}</button></div></div>
      </div>
    </div>
  );
}
