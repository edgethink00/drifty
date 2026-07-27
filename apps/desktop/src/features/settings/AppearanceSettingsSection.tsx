import { useEffect, useState } from "react";
import type { ActivityCategory, TrayIconStyle } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { CategoryColorControls, ThemeColorControls, type AppThemeColorKey } from "./SettingsColorControls";
import type { AppThemeColorOverrides, CategoryColorOverrides, ThemeMode } from "./settingsStorage";
import {
  APP_THEME_ACCENT_COLOR_OPTIONS,
  APP_THEME_PRODUCTIVITY_COLOR_OPTIONS,
  CATEGORY_COLOR_OPTIONS,
  MENU_BAR_ICON_STYLE_STORAGE_KEY,
  MENU_BAR_ICON_STYLE_OPTIONS,
  resolveInitialMenuBarIconStyle,
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
  const [menuBarIconStyle, setMenuBarIconStyle] = useState<TrayIconStyle>(resolveInitialMenuBarIconStyle);
  const colorRoleCount =
    CATEGORY_COLOR_OPTIONS.length
    + APP_THEME_ACCENT_COLOR_OPTIONS.length
    + APP_THEME_PRODUCTIVITY_COLOR_OPTIONS.length;

  useEffect(() => {
    window.localStorage.setItem(MENU_BAR_ICON_STYLE_STORAGE_KEY, menuBarIconStyle);
    void trackerClient.updateTrayIconStyle(menuBarIconStyle).catch(() => undefined);
  }, [menuBarIconStyle]);

  return (
    <div className="settings-section settings-section--appearance">
      <div className="settings-block"><h3>{t("settings.section.appearance")}</h3>
        <div className="settings-row"><div><div className="lbl">{t("settings.appearance.theme")}</div><div className="desc">{t("settings.appearance.themeDescription")}</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label={t("settings.appearance.theme")}><button type="button" className={`settings-mode-option${theme === "light" ? " is-active" : ""}`} role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")}><span>{t("settings.appearance.light")}</span></button><button type="button" className={`settings-mode-option${theme === "dark" ? " is-active" : ""}`} role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")}><span>{t("settings.appearance.dark")}</span></button></div></div></div>
        <div className="settings-row"><div><div className="lbl">{t("settings.appearance.menuBarIcon")}</div><div className="desc">{t("settings.appearance.menuBarIconDescription")}</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label={t("settings.appearance.menuBarIcon")}>{MENU_BAR_ICON_STYLE_OPTIONS.map((option) => <button key={option.value} type="button" className={`settings-mode-option${menuBarIconStyle === option.value ? " is-active" : ""}`} role="radio" aria-checked={menuBarIconStyle === option.value} onClick={() => setMenuBarIconStyle(option.value)}><span>{option.value === "compact" ? t("settings.appearance.ringOnly") : t("settings.appearance.logoRing")}</span></button>)}</div></div></div>
      </div>
      <div className="settings-block"><h3>{t("settings.appearance.colors")}</h3>
        <SettingsCollapsibleCard
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
