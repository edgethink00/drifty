import { useLocalization } from "../../localization/LocalizationContext";
import { DISPLAY_LANGUAGES, isDisplayLanguage, languageDisplayName } from "../../localization/languageCatalog";

/**
 * The entry screen's language switch: a quiet pill that names the current language beside a
 * globe, so someone who cannot read that language still finds it. The pill is only the face;
 * a transparent native select covers it, so clicking opens the system's own menu and every
 * language stays reachable with the keyboard and screen readers.
 */
export function OnboardingLanguageToggle() {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  return (
    <span className="dc-onb-language-picker">
      <svg className="dc-onb-language-picker__globe" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 12h16.8M12 3c2.2 2.4 3.4 5.4 3.4 9s-1.2 6.6-3.4 9M12 3C9.8 5.4 8.6 8.4 8.6 12s1.2 6.6 3.4 9" />
      </svg>
      <span className="dc-onb-language-picker__label" lang={effectiveLanguage} aria-hidden="true">
        {languageDisplayName(effectiveLanguage)}
      </span>
      <svg className="dc-onb-language-picker__chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 10 5 5 5-5" />
      </svg>
      <select className="dc-onb-language-select" aria-label={t("settings.general.language")} value={effectiveLanguage}
        onChange={(event) => { if (isDisplayLanguage(event.target.value)) setDisplayLanguage(event.target.value); }}>
        {DISPLAY_LANGUAGES.map(({ value, label }) => <option key={value} value={value} lang={value}>{label}</option>)}
      </select>
    </span>
  );
}
