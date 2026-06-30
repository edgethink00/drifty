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
  const [menuBarIconStyle, setMenuBarIconStyle] = useState<TrayIconStyle>(resolveInitialMenuBarIconStyle);

  useEffect(() => {
    window.localStorage.setItem(MENU_BAR_ICON_STYLE_STORAGE_KEY, menuBarIconStyle);
    void trackerClient.updateTrayIconStyle(menuBarIconStyle).catch(() => undefined);
  }, [menuBarIconStyle]);

  return (
    <div className="settings-section settings-section--appearance">
      <div className="settings-block"><h3>Appearance</h3>
        <div className="settings-row"><div><div className="lbl">Theme</div><div className="desc">Matches the titlebar theme switch.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Theme"><button type="button" className={`settings-mode-option${theme === "light" ? " is-active" : ""}`} role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")}><span>Light</span></button><button type="button" className={`settings-mode-option${theme === "dark" ? " is-active" : ""}`} role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")}><span>Dark</span></button></div></div></div>
        <div className="settings-row"><div><div className="lbl">Menu bar icon</div><div className="desc">Default is the compact productivity ring.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Menu bar icon">{MENU_BAR_ICON_STYLE_OPTIONS.map((option) => <button key={option.value} type="button" className={`settings-mode-option${menuBarIconStyle === option.value ? " is-active" : ""}`} role="radio" aria-checked={menuBarIconStyle === option.value} onClick={() => setMenuBarIconStyle(option.value)}><span>{option.label}</span></button>)}</div></div></div>
      </div>
      <div className="settings-block"><h3>Colors</h3>
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
      </div>
    </div>
  );
}
