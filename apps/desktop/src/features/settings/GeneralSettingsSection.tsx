import { DISPLAY_LANGUAGES, languageDisplayName } from "../localization/languageCatalog";
import type { ReactNode } from "react";
import { Toggle } from "../../components/Toggle";
import { SettingsSelect } from "./SettingsSelect";
import { StartupSettingsRow } from "./StartupSettingsRow";
import type { StartOfWeek } from "./settingsStorage";
import {
  START_OF_DAY_OPTIONS,
} from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { localizeUpdateMessage } from "../localization/settingsMessageTranslations";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { ActionLabel } from "../../components/ActionLabel";

type GeneralSettingsSectionProps = {
  /** Theme and accent; Appearance folded into General once its colors moved to Categories. */
  readonly appearance?: ReactNode;
  /** The door to the category editor, right under appearance where colors used to be. */
  readonly categories?: ReactNode;
  readonly backgroundUpdatesEnabled: boolean;
  readonly backgroundUpdatesSupported: boolean;
  /** Running app version shown beside the manual update check. */
  readonly currentVersion?: string | null;
  readonly devModeEnabled?: boolean;
  readonly hostPlatform?: HostPlatform;
  /** OS permission status block; it lives at the end of General instead of its own page. */
  readonly permissions?: ReactNode;
  readonly showDevMode?: boolean;
  readonly startOfDayValue: string;
  readonly startOfWeek: StartOfWeek;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
  readonly onBackgroundUpdatesEnabledChange: (enabled: boolean) => void;
  readonly onCheckForUpdates: () => void;
  /** Opens the What's new dialog; omitted when this build has no notes. */
  readonly onOpenWhatsNew?: () => void;
  readonly onDevModeChange?: (enabled: boolean) => void;
  readonly onStartOfDayChange: (value: string) => void;
  readonly onStartOfWeekChange: (value: StartOfWeek) => void;
};

export function GeneralSettingsSection({
  appearance = null,
  categories = null,
  backgroundUpdatesEnabled,
  backgroundUpdatesSupported,
  currentVersion = null,
  devModeEnabled = false,
  hostPlatform = "macos",
  permissions = null,
  showDevMode = false,
  startOfDayValue,
  startOfWeek,
  updaterChecking,
  updaterError,
  updaterInstalling,
  updaterMessage,
  onBackgroundUpdatesEnabledChange,
  onCheckForUpdates,
  onOpenWhatsNew,
  onDevModeChange,
  onStartOfDayChange,
  onStartOfWeekChange,
}: GeneralSettingsSectionProps) {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  const languageOptions = DISPLAY_LANGUAGES.map(({ value }) => ({ value, label: languageDisplayName(value, t) }));
  const startOfWeekOptions = [
    { value: "monday", label: t("settings.weekday.monday") },
    { value: "sunday", label: t("settings.weekday.sunday") },
    { value: "saturday", label: t("settings.weekday.saturday") },
  ] satisfies ReadonlyArray<{ value: StartOfWeek; label: string }>;
  const startOfDayOptions = START_OF_DAY_OPTIONS.map((option) => ({
    ...option,
    label: formatStartOfDayOptionLabel(option.minutes, localeForDisplayLanguage(effectiveLanguage)),
  }));
  // While a check runs its button says so; the controller's "Checking…" status
  // would only repeat it. A result (or failure) then sits beside the version on
  // the same line, so the row never gains a line and the blocks below stay put.
  const updateOutcome = updaterError
    ? { text: localizeUpdateMessage(updaterError, "error", effectiveLanguage, t), tone: "error" as const }
    : updaterMessage && !updaterChecking
      ? { text: localizeUpdateMessage(updaterMessage, "status", effectiveLanguage, t), tone: "status" as const }
      : null;

  return (
    <div className="settings-section settings-section--general">
      <div className="settings-block"><h3>{t("settings.section.general")}</h3>
        <div data-setting-id="settings.general.language" className="settings-row"><div><div className="lbl">{t("settings.general.language")}</div><div className="desc">{t(hostPlatform === "windows" ? "settings.general.languageDescriptionWindows" : "settings.general.languageDescription")}</div></div><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.language")} value={effectiveLanguage} options={languageOptions} onChange={setDisplayLanguage} /></div></div>
        <div data-setting-id="settings.general.startOfDay" className="settings-row"><label><div className="lbl">{t("settings.general.startOfDay")}</div><div className="desc">{t(hostPlatform === "windows" ? "settings.general.startOfDayDescriptionWindows" : "settings.general.startOfDayDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfDay")} value={startOfDayValue} options={startOfDayOptions} onChange={onStartOfDayChange} /></div></div>
        <div data-setting-id="settings.general.startOfWeek" className="settings-row"><label><div className="lbl">{t("settings.general.startOfWeek")}</div><div className="desc">{t("settings.general.startOfWeekDescription")}</div></label><div className="ctrl"><SettingsSelect ariaLabel={t("settings.general.startOfWeek")} value={startOfWeek} options={startOfWeekOptions} onChange={onStartOfWeekChange} /></div></div>
      </div>
      {appearance}
      {categories}
      <div className="settings-block"><h3>{t("settings.general.startup")}</h3>
        <StartupSettingsRow />
      </div>
      <div className="settings-block"><h3>{t("settings.general.updates")}</h3>
        {backgroundUpdatesSupported ? <div data-setting-id="settings.general.autoUpdates" className="settings-row"><div><div className="lbl">{t("settings.general.autoUpdates")}</div><div className="desc">{t("settings.general.autoUpdatesDescription")}</div></div><div className="ctrl"><Toggle checked={backgroundUpdatesEnabled} onChange={onBackgroundUpdatesEnabledChange} ariaLabel={t("settings.general.autoUpdates")} /></div></div> : null}
        <div data-setting-id="settings.general.manualUpdate" className="settings-row">
          <div>
            <div className="lbl">{t("settings.general.manualUpdate")}</div>
            {currentVersion || updateOutcome ? (
              <div className="desc settings-update-version" title={updateOutcome?.text}>
                {currentVersion ? <span className="settings-update-version__current">{t("settings.general.currentVersion", { version: currentVersion })}</span> : null}
                {updateOutcome ? (
                  <span
                    className={`settings-update-outcome${updateOutcome.tone === "error" ? " settings-update-outcome--error" : ""}`}
                    role={updateOutcome.tone === "error" ? "alert" : "status"}
                  >
                    {updateOutcome.text}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="ctrl settings-update-actions">
            {onOpenWhatsNew ? <button type="button" className="settings-inline-link" onClick={onOpenWhatsNew}>{t("settings.general.whatsNew")}</button> : null}
            <button type="button" className="settings-btn" onClick={onCheckForUpdates} disabled={updaterChecking || updaterInstalling} aria-busy={updaterChecking}><ActionLabel busy={updaterChecking} busyLabel={t("settings.general.checking")}>{t("settings.general.checkForUpdates")}</ActionLabel></button>
          </div>
        </div>
      </div>
      {permissions}
      {showDevMode && hostPlatform === "windows" ? <div className="settings-block"><h3>{t("settings.general.developer")}</h3>
        <div data-setting-id="settings.general.devMode" className="settings-row"><div><div className="lbl">{t("settings.general.devMode")}</div><div id="settings-general-dev-mode-description" className="desc">{t("settings.general.devModeDescriptionWindows")}</div></div><div className="ctrl"><Toggle checked={devModeEnabled} onChange={onDevModeChange} ariaLabel={t("settings.general.devMode")} ariaDescribedBy="settings-general-dev-mode-description" /></div></div>
      </div> : null}
    </div>
  );
}
