import type { LocalizationController } from "../localization/LocalizationContext";

export function screenAiCopy(t: LocalizationController["t"]) {
  return {
    title: t("screenAi.title"),
    description: t("screenAi.description"),
    off: t("screenAi.off"),
    on: t("screenAi.on"),
    sources: t("screenAi.sources"),
    purposes: t("screenAi.purposes"),
    appText: t("screenAi.appText"),
    ocr: t("screenAi.ocr"),
    images: t("screenAi.images"),
    unsupportedImages: t("screenAi.unsupportedImages"),
    classification: t("screenAi.classification"),
    projects: t("screenAi.projects"),
    cards: t("screenAi.cards"),
    recipient: t("screenAi.recipient"),
    unavailable: t("screenAi.unavailable"),
    local: t("screenAi.local"),
    privacy: t("screenAi.privacy"),
    review: t("screenAi.review"),
    turnOff: t("screenAi.turnOff"),
    confirmTitle: t("screenAi.confirmTitle"),
    confirmDescription: t("screenAi.confirmDescription"),
    cancel: t("screenAi.cancel"),
    confirm: t("screenAi.confirm"),
    saveFailed: t("screenAi.saveFailed"),
    loadFailed: t("screenAi.loadFailed"),
    reviewExpired: t("screenAi.reviewExpired"),
    saving: t("screenAi.saving"),
    saved: t("screenAi.saved"),
    notDelivering: t("screenAi.notDelivering"),
    invalidPreferences: t("screenAi.invalidPreferences"),
    unsavedOff: t("screenAi.unsavedOff"),
    retry: t("screenAi.retry"),
  };
}
export type ScreenAiCopy = ReturnType<typeof screenAiCopy>;
