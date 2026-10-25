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
  readonly onAppThemeColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onAppThemeColorReset: (key: AppThemeColorKey) => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
};

/**
 * App chrome — theme, Windows blur, accent, the Mac app icon — as one block of General.
 * Productivity and category colors belong to their definitions in the
 * category editor, so what is left here is small enough to share a page.
 */
export function AppearanceSettingsBlock({
  appThemeColorOverrides,
  theme,
  hostPlatform,
  windowsBlurEnabled,
  onWindowsBlurEnabledChange,
  onAppThemeColorChange,
  onAppThemeColorReset,
  onThemeChange,
}: AppearanceSettingsBlockProps) {
  const { t } = useLocalization();

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
