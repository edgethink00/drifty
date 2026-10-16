import { useRef, type KeyboardEvent } from "react";
import {
  useLocalization,
  type DisplayLanguage,
} from "../../localization/LocalizationContext";

const OPTIONS: readonly { language: DisplayLanguage; label: string }[] = [
  { language: "en", label: "English" },
  { language: "ko", label: "한국어" },
  { language: "es", label: "Español" },
];

export function OnboardingLanguageToggle() {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  const optionRefs = useRef<Partial<Record<DisplayLanguage, HTMLButtonElement>>>({});
  const selectLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language);
    optionRefs.current[language]?.focus();
  };

  const handleLanguageKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = OPTIONS.findIndex((option) => option.language === effectiveLanguage);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? OPTIONS.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + OPTIONS.length) % OPTIONS.length
          : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % OPTIONS.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    selectLanguage(OPTIONS[nextIndex].language);
  };

  return (
    <div className="dc-onb-language" role="radiogroup" aria-label={t("settings.general.language")}>
      {OPTIONS.map(({ language, label }) => (
        <button
          key={language}
          ref={(element) => { if (element) optionRefs.current[language] = element; }}
          type="button"
          className="dc-onb-language__option"
          role="radio"
          aria-checked={effectiveLanguage === language}
          tabIndex={effectiveLanguage === language ? 0 : -1}
          onClick={() => selectLanguage(language)}
          onKeyDown={handleLanguageKeyDown}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
