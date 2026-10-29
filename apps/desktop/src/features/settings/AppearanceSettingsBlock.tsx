import { useId } from "react";
import { Toggle } from "../../components/Toggle";
import { WindowsBlurSettingsRow } from "./WindowsBlurSettingsRow";
import { AppIconSettingsRow } from "./AppIconSettingsRow";
import { AccentColorRow } from "./AccentColorRow";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import type { AppThemeColorKey } from "./SettingsColorControls";
import type { AppThemeColorOverrides, ThemePreference } from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "./SettingsSelect";
import { DockVisibilitySettingsRow, UiZoomSettingsRow } from "../feedback-requests/FeedbackRequestSettingsRows";

type AppearanceSettingsBlockProps = {
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly theme: ThemePreference;
  readonly hostPlatform: HostPlatform;
  readonly windowsBlurEnabled: boolean;
  readonly onWindowsBlurEnabledChange: (enabled: boolean) => void;
  readonly previousDashboardLayout: boolean;
  readonly onPreviousDashboardLayoutChange: (previous: boolean) => void;
  readonly onAppThemeColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onAppThemeColorReset: (key: AppThemeColorKey) => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
};

/**
 * App chrome — theme, window size, the previous dashboard layout, Windows blur, accent, the Mac
 * app icon — as one block of General. Productivity and category colors belong to their
 * definitions in the category editor, so what is left here is small enough to share a page.
 */
export function AppearanceSettingsBlock({
  appThemeColorOverrides,
  theme,
  hostPlatform,
  windowsBlurEnabled,
  onWindowsBlurEnabledChange,
  previousDashboardLayout,
  onPreviousDashboardLayoutChange,
  onAppThemeColorChange,
  onAppThemeColorReset,
  onThemeChange,
}: AppearanceSettingsBlockProps) {
  const { t } = useLocalization();
  const previousDashboardDescriptionId = useId();

  // The block keeps the Appearance styling scope (settings-section--appearance)
  // inside General.
  return (
    <div className="settings-block settings-block--appearance settings-section--appearance"><h3>{t("settings.section.appearance")}</h3>
      <div data-setting-id="settings.appearance.theme" className="settings-row"><div><div className="lbl">{t("settings.appearance.theme")}</div><div className="desc">{t("settings.appearance.themeDescription")}</div></div><div className="ctrl"><SettingsSelect
        ariaLabel={t("settings.appearance.theme")}
        value={theme}
        options={[
          { value: "system", label: t("settings.appearance.system") },
          { value: "light", label: t("settings.appearance.light") },
          { value: "dark", label: t("settings.appearance.dark") },
        ]}
        onChange={onThemeChange}
      /></div></div>
      <UiZoomSettingsRow hostPlatform={hostPlatform} />
      <div data-setting-id="settings.appearance.previousDashboard" className="settings-row">
        <div>
          <div className="lbl">{t("settings.appearance.previousDashboard")}</div>
          <div className="desc" id={previousDashboardDescriptionId}>{t("settings.appearance.previousDashboardDescription")}</div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={previousDashboardLayout}
            onChange={onPreviousDashboardLayoutChange}
            ariaLabel={t("settings.appearance.previousDashboard")}
            ariaDescribedBy={previousDashboardDescriptionId}
          />
        </div>
      </div>
      {hostPlatform === "windows" && <WindowsBlurSettingsRow enabled={windowsBlurEnabled} onEnabledChange={onWindowsBlurEnabledChange} />}
      <AccentColorRow
        accent={appThemeColorOverrides.accent}
        onAccentChange={(color) => onAppThemeColorChange("accent", color)}
        onAccentReset={() => onAppThemeColorReset("accent")}
      />
      {hostPlatform === "macos" && <AppIconSettingsRow />}
      {hostPlatform === "macos" && <DockVisibilitySettingsRow />}
    </div>
  );
}
