import type { ActivityCategory } from "@drifty/domain";
import { CategoryColorControls, ThemeColorControls, type AppThemeColorKey } from "./SettingsColorControls";
import type { AppThemeColorOverrides, CategoryColorOverrides, ThemeMode } from "./settingsStorage";
import {
  APP_THEME_ACCENT_COLOR_OPTIONS,
  APP_THEME_PRODUCTIVITY_COLOR_OPTIONS,
  CATEGORY_COLOR_OPTIONS,
} from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";

type AppearanceSettingsSectionProps = {
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly theme: ThemeMode;
  readonly onAppThemeColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onAppThemeColorReset: (key: AppThemeColorKey) => void;
  readonly onCategoryColorChange: (key: ActivityCategory, value: string) => void;
  readonly onCategoryColorReset: (key: ActivityCategory) => void;
  readonly onThemeChange: (theme: ThemeMode) => void;
};

export function AppearanceSettingsSection({
  appThemeColorOverrides,
  categoryColorOverrides,
  theme,
  onAppThemeColorChange,
  onAppThemeColorReset,
  onCategoryColorChange,
  onCategoryColorReset,
  onThemeChange,
}: AppearanceSettingsSectionProps) {
  const { t } = useLocalization();
  const colorRoleCount =
    CATEGORY_COLOR_OPTIONS.length
    + APP_THEME_ACCENT_COLOR_OPTIONS.length
    + APP_THEME_PRODUCTIVITY_COLOR_OPTIONS.length;

  return (
    <div className="settings-section settings-section--appearance">
      <div className="settings-block"><h3>{t("settings.section.appearance")}</h3>
        <div data-setting-id="settings.appearance.theme" className="settings-row"><div><div className="lbl">{t("settings.appearance.theme")}</div><div className="desc">{t("settings.appearance.themeDescription")}</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label={t("settings.appearance.theme")}><button type="button" className={`settings-mode-option${theme === "light" ? " is-active" : ""}`} role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")}><span>{t("settings.appearance.light")}</span></button><button type="button" className={`settings-mode-option${theme === "dark" ? " is-active" : ""}`} role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")}><span>{t("settings.appearance.dark")}</span></button></div></div></div>
      </div>
      <div className="settings-block"><h3>{t("settings.appearance.colors")}</h3>
        <SettingsCollapsibleCard searchReveal="appearance-colors"
          title={t("settings.appearance.advancedColors")}
          subtitle={t("settings.appearance.advancedColorsDescription")}
          summary={t("settings.appearance.colorRoles", { count: colorRoleCount })}
        >
          <CategoryColorControls
            options={CATEGORY_COLOR_OPTIONS}
            overrides={categoryColorOverrides}
            onColorChange={onCategoryColorChange}
            onColorReset={onCategoryColorReset}
          />
          <ThemeColorControls
            accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS}
            productivityOptions={APP_THEME_PRODUCTIVITY_COLOR_OPTIONS}
            overrides={appThemeColorOverrides}
            onColorChange={onAppThemeColorChange}
            onColorReset={onAppThemeColorReset}
          />
        </SettingsCollapsibleCard>
      </div>
    </div>
  );
}
