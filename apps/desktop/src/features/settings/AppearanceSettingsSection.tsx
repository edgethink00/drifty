import { WindowsBlurSettingsRow } from "./WindowsBlurSettingsRow";
import { AppIconSettingsRow } from "./AppIconSettingsRow";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import type { ActivityCategory } from "@drifty/domain";
import { AccentColorControl, CategoryColorControls, ProductivityColorControls, type AppThemeColorKey } from "./SettingsColorControls";
import type { AppThemeColorOverrides, CategoryColorOverrides, ThemeMode } from "./settingsStorage";
import {
  APP_THEME_ACCENT_COLOR_OPTIONS,
  APP_THEME_PRODUCTIVITY_COLOR_OPTIONS,
  CATEGORY_COLOR_OPTIONS,
} from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "./SettingsSelect";

type AppearanceSettingsSectionProps = {
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly theme: ThemeMode;
  readonly hostPlatform: HostPlatform;
  readonly windowsBlurEnabled: boolean;
  readonly onWindowsBlurEnabledChange: (enabled: boolean) => void;
  readonly onAppThemeColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onAppThemeColorReset: (key: AppThemeColorKey) => void;
  readonly onCategoryColorChange: (key: ActivityCategory, value: string) => void;
  readonly onCategoryColorReset: (key: ActivityCategory) => void;
  readonly onThemeChange: (theme: ThemeMode) => void;
};

/**
 * Two blocks: app chrome (theme, accent) and activity semantics (productivity,
 * categories), small group before large. Nothing collapses — at rest each
 * color row is a one-line legend of what the colors currently are.
 */
export function AppearanceSettingsSection({
  appThemeColorOverrides,
  categoryColorOverrides,
  theme,
  hostPlatform,
  windowsBlurEnabled,
  onWindowsBlurEnabledChange,
  onAppThemeColorChange,
  onAppThemeColorReset,
  onCategoryColorChange,
  onCategoryColorReset,
  onThemeChange,
}: AppearanceSettingsSectionProps) {
  const { t } = useLocalization();

  return (
    <div className="settings-section settings-section--appearance">
      <div className="settings-block"><h3>{t("settings.section.appearance")}</h3>
        <div data-setting-id="settings.appearance.theme" className="settings-row"><div><div className="lbl">{t("settings.appearance.theme")}</div><div className="desc">{t("settings.appearance.themeDescription")}</div></div><div className="ctrl"><SettingsSelect
          ariaLabel={t("settings.appearance.theme")}
          value={theme}
          options={[
            { value: "light", label: t("settings.appearance.light") },
            { value: "dark", label: t("settings.appearance.dark") },
          ]}
          onChange={onThemeChange}
        /></div></div>
        {hostPlatform === "windows" && <WindowsBlurSettingsRow enabled={windowsBlurEnabled} onEnabledChange={onWindowsBlurEnabledChange} />}
        <AccentColorControl
          accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS}
          overrides={appThemeColorOverrides}
          onColorChange={onAppThemeColorChange}
          onColorReset={onAppThemeColorReset}
        />
        {hostPlatform === "macos" && <AppIconSettingsRow />}
      </div>
      <div className="settings-block"><h3>{t("settings.appearance.activityColors")}</h3>
        <ProductivityColorControls
          productivityOptions={APP_THEME_PRODUCTIVITY_COLOR_OPTIONS}
          overrides={appThemeColorOverrides}
          onColorChange={onAppThemeColorChange}
          onColorReset={onAppThemeColorReset}
        />
        <CategoryColorControls
          options={CATEGORY_COLOR_OPTIONS}
          overrides={categoryColorOverrides}
          onColorChange={onCategoryColorChange}
          onColorReset={onCategoryColorReset}
        />
      </div>
    </div>
  );
}
