import classicIcon from "../../assets/app-icons/classic.png";
import midnightIcon from "../../assets/app-icons/midnight.png";
import plumIcon from "../../assets/app-icons/plum.png";
import flowIcon from "../../assets/app-icons/flow.png";
import retroIcon from "../../assets/app-icons/retro.png";
import peekIcon from "../../assets/app-icons/peek.png";
import omegaIcon from "../../assets/app-icons/omega.png";
import windowIcon from "../../assets/app-icons/window.png";
import catIvoryIcon from "../../assets/app-icons/cat-ivory.png";
import catCharcoalIcon from "../../assets/app-icons/cat-charcoal.png";
import catPlumIcon from "../../assets/app-icons/cat-plum.png";
import type { AppIconVariantId } from "../../lib/api/appIconClient";
import { presetForColor } from "../../lib/colorPalette";
import type { LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { PetModeCoat } from "../pet-mode/petModeData";
import type { ProLook } from "./proLooks";

// The previews are the same generated artwork the Dock receives
// (scripts/generate-app-icon-variants.mjs), so what is picked is what shows.
export const APP_ICON_PREVIEWS: Readonly<Record<AppIconVariantId, string>> = {
  classic: classicIcon,
  midnight: midnightIcon,
  plum: plumIcon,
  flow: flowIcon,
  retro: retroIcon,
  peek: peekIcon,
  omega: omegaIcon,
  window: windowIcon,
  "cat-ivory": catIvoryIcon,
  "cat-charcoal": catCharcoalIcon,
  "cat-plum": catPlumIcon,
};

export const APP_ICON_LABEL_KEYS: Readonly<Record<AppIconVariantId, TranslationKey>> = {
  classic: "settings.appearance.appIconClassic",
  midnight: "settings.appearance.appIconMidnight",
  plum: "settings.appearance.appIconPlum",
  flow: "settings.appearance.appIconFlow",
  retro: "settings.appearance.appIconRetro",
  peek: "settings.appearance.appIconPeek",
  omega: "settings.appearance.appIconOmega",
  window: "settings.appearance.appIconWindow",
  "cat-ivory": "settings.appearance.appIconCatIvory",
  "cat-charcoal": "settings.appearance.appIconCatCharcoal",
  "cat-plum": "settings.appearance.appIconCatPlum",
};

export function localizedPetCoatLabel(coat: PetModeCoat, t: LocalizationController["t"]): string {
  return t(coat.startsWith("custom-") ? "settings.pet.skinCustom" : `settings.pet.skinNames.${coat}` as TranslationKey);
}

/** A palette accent's own name; any other color is the person's own. */
export function localizedAccentLabel(color: string, t: LocalizationController["t"]): string {
  const preset = presetForColor(color);
  return preset ? t(`settings.appearance.preset.${preset.id}` as TranslationKey) : t("settings.appearance.customAccentName");
}

export function localizedProLookLabel(look: ProLook, t: LocalizationController["t"]): string {
  switch (look.kind) {
    case "icon": return t(APP_ICON_LABEL_KEYS[look.id]);
    case "coat": return localizedPetCoatLabel(look.id, t);
    case "accent": return localizedAccentLabel(look.id, t);
  }
}

