import { useLayoutEffect } from "react";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { useLocalization } from "../localization/LocalizationContext";

/**
 * Development review only (the intro review mode is already limited to dev builds):
 * ?driftyIntroPlatform=windows previews the Windows copy and taskbar art in a browser, and
 * ?driftyIntroLang=en|ko switches the app language through the normal language setting.
 */
export function useIntroReviewOverrides(reviewEnabled: boolean, hostPlatform: HostPlatform): HostPlatform {
  const params = reviewEnabled ? new URLSearchParams(window.location.search) : null;
  const language = params?.get("driftyIntroLang");
  const { effectiveLanguage, setDisplayLanguage } = useLocalization();
  useLayoutEffect(() => {
    if ((language === "en" || language === "ko") && language !== effectiveLanguage) setDisplayLanguage(language);
  }, [language, effectiveLanguage, setDisplayLanguage]);
  return params?.get("driftyIntroPlatform") === "windows" ? "windows" : hostPlatform;
}
