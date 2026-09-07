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
import { END_OF_DAY_REVIEW_MINUTE_OPTIONS } from "../companion/endOfDayReviewSchedule";

type GeneralSettingsSectionProps = {
  readonly backgroundUpdatesEnabled: boolean;
  readonly backgroundUpdatesSupported: boolean;
  readonly dayReviewTimeValue: string;
  readonly startOfDayValue: string;
  readonly startOfWeek: StartOfWeek;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
  readonly onBackgroundUpdatesEnabledChange: (enabled: boolean) => void;
  readonly onCheckForUpdates: () => void;
  readonly onDayReviewTimeChange: (value: string) => void;
  readonly onStartOfDayChange: (value: string) => void;
  readonly onStartOfWeekChange: (value: StartOfWeek) => void;
};

export function GeneralSettingsSection({
  backgroundUpdatesEnabled,
  backgroundUpdatesSupported,
  dayReviewTimeValue,
  startOfDayValue,
  startOfWeek,
  updaterChecking,
  updaterError,
  updaterInstalling,
  updaterMessage,
  onBackgroundUpdatesEnabledChange,
  onCheckForUpdates,
  onDayReviewTimeChange,
  onStartOfDayChange,
  onStartOfWeekChange,
}: GeneralSettingsSectionProps) {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  const languageOptions = [
    { value: "en", label: t("settings.general.languageEnglish") },
    { value: "ko", label: t("settings.general.languageKorean") },
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
  const dayReviewTimeOptions = END_OF_DAY_REVIEW_MINUTE_OPTIONS.map((option) => ({
    value: option.value,
    label: formatStartOfDayOptionLabel(option.minutes, effectiveLanguage === "ko" ? "ko-KR" : "en-US"),
  }));

  return (
    <div className="settings-section settings-section--general">
      <div className="settings-block"><h3>{t("settings.section.general")}</h3>
        <div data-setting-id="settings.general.language" className="settings-row"><div><div className="lbl">{t("settings.general.language")}</div><div className="desc">{t("settings.general.languageDescription")}</div></div><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.language")} value={effectiveLanguage} options={languageOptions} onChange={setDisplayLanguage} /></div></div>
        <div data-setting-id="settings.general.startOfDay" className="settings-row"><label><div className="lbl">{t("settings.general.startOfDay")}</div><div className="desc">{t("settings.general.startOfDayDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfDay")} value={startOfDayValue} options={startOfDayOptions} onChange={onStartOfDayChange} /></div></div>
        <div data-setting-id="settings.general.startOfWeek" className="settings-row"><label><div className="lbl">{t("settings.general.startOfWeek")}</div><div className="desc">{t("settings.general.startOfWeekDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfWeek")} value={startOfWeek} options={startOfWeekOptions} onChange={onStartOfWeekChange} /></div></div>
        <div data-setting-id="settings.general.dayReviewTime" className="settings-row"><label><div className="lbl">{t("settings.general.dayReviewTime")}</div><div className="desc">{t("settings.general.dayReviewTimeDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.dayReviewTime")} value={dayReviewTimeValue} options={dayReviewTimeOptions} onChange={onDayReviewTimeChange} /></div></div>
      </div>
      <div className="settings-block"><h3>{t("settings.general.startup")}</h3>
        <StartupSettingsRow />
      </div>
      <div className="settings-block"><h3>{t("settings.general.updates")}</h3>
        {backgroundUpdatesSupported ? <div data-setting-id="settings.general.autoUpdates" className="settings-row"><div><div className="lbl">{t("settings.general.autoUpdates")}</div><div className="desc">{t("settings.general.autoUpdatesDescription")}</div></div><div className="ctrl"><Toggle checked={backgroundUpdatesEnabled} onChange={onBackgroundUpdatesEnabledChange} ariaLabel={t("settings.general.autoUpdates")} /></div></div> : null}
        <div data-setting-id="settings.general.manualUpdate" className="settings-row"><div><div className="lbl">{t("settings.general.manualUpdate")}</div><div className="desc">{t("settings.general.manualUpdateDescription")}</div>{updaterMessage ? <p className="capture-recency" role="status">{localizeUpdateMessage(updaterMessage, "status", effectiveLanguage, t)}</p> : null}{updaterError ? <p className="capture-recency capture-recency--error" role="alert">{localizeUpdateMessage(updaterError, "error", effectiveLanguage, t)}</p> : null}</div><div className="ctrl"><button type="button" className="settings-btn" onClick={onCheckForUpdates} disabled={updaterChecking || updaterInstalling}>{updaterChecking ? t("settings.general.checking") : t("settings.general.checkForUpdates")}</button></div></div>
      </div>
    </div>
  );
}
