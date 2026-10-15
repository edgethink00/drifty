import { useLocalization } from "../localization/LocalizationContext";
import { PencilIcon } from "../categories/definitionIcons";
import "../categories/categoryEditor.css";

/**
 * General → Categories: the Settings door to the category editor, which also
 * opens from the Classification page, the correction popover and the Projects
 * page. App and site rules live in Settings › Memory.
 */
export function CategoriesSettingsBlock({ onOpen }: { readonly onOpen: () => void }) {
  const { t } = useLocalization();
  return (
    <div className="settings-block">
      <h3>{t("settings.categories.title")}</h3>
      <div data-setting-id="settings.categories.title" className="settings-row">
        <div>
          <div className="lbl">{t("categoryEditor.settingsRow")}</div>
          <div className="desc">{t("categoryEditor.settingsRowDescription")}</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn category-editor-entry" aria-haspopup="dialog" onClick={onOpen}>
            <PencilIcon />
            {t("common.edit")}
          </button>
        </div>
      </div>
    </div>
  );
}
