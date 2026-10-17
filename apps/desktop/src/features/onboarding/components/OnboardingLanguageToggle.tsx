import { useLocalization } from "../../localization/LocalizationContext";
import { DISPLAY_LANGUAGES, isDisplayLanguage } from "../../localization/languageCatalog";

export function OnboardingLanguageToggle() {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  return (
    <select className="dc-onb-language-select" aria-label={t("settings.general.language")} value={effectiveLanguage}
      onChange={(event) => { if (isDisplayLanguage(event.target.value)) setDisplayLanguage(event.target.value); }}>
      {DISPLAY_LANGUAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}
