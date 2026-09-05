import { useRef, type KeyboardEvent } from "react";
import {
  resolveSystemDisplayLanguage,
  useLocalization,
  type DisplayLanguage,
} from "../../localization/LocalizationContext";

export function OnboardingLanguageToggle() {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  const englishOptionRef = useRef<HTMLButtonElement>(null);
  const koreanOptionRef = useRef<HTMLButtonElement>(null);
  const systemLanguage = typeof navigator === "undefined"
    ? "en"
    : resolveSystemDisplayLanguage(navigator);

  if (systemLanguage !== "ko") return null;

  const selectLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language);
    (language === "en" ? englishOptionRef : koreanOptionRef).current?.focus();
  };

  const handleLanguageKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextLanguage: DisplayLanguage;
    switch (event.key) {
      case "Home":
        nextLanguage = "en";
        break;
      case "End":
        nextLanguage = "ko";
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        nextLanguage = effectiveLanguage === "en" ? "ko" : "en";
        break;
      default:
        return;
    }

    event.preventDefault();
    selectLanguage(nextLanguage);
  };

  return (
    <div className="dc-onb-language" role="radiogroup" aria-label={t("settings.general.language")}>
      <button
        ref={englishOptionRef}
        type="button"
        className="dc-onb-language__option"
        role="radio"
        aria-checked={effectiveLanguage === "en"}
        tabIndex={effectiveLanguage === "en" ? 0 : -1}
        onClick={() => selectLanguage("en")}
        onKeyDown={handleLanguageKeyDown}
      >
        English
      </button>
      <button
        ref={koreanOptionRef}
        type="button"
        className="dc-onb-language__option"
        role="radio"
        aria-checked={effectiveLanguage === "ko"}
        tabIndex={effectiveLanguage === "ko" ? 0 : -1}
        onClick={() => selectLanguage("ko")}
        onKeyDown={handleLanguageKeyDown}
      >
        한국어
      </button>
    </div>
  );
}
