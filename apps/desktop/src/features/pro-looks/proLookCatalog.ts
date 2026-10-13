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

const PET_COAT_LABEL_KEYS: Readonly<Record<PetModeCoat, TranslationKey>> = {
  ivory: "settings.pet.coatIvory",
  charcoal: "settings.pet.coatCharcoal",
  grey: "settings.pet.coatGrey",
  apricot: "settings.pet.coatApricot",
  sage: "settings.pet.coatSage",
  plum: "settings.pet.coatPlum",
};

export function localizedPetCoatLabel(
  coat: PetModeCoat,
  t: LocalizationController["t"],
): string {
  return t(PET_COAT_LABEL_KEYS[coat]);
}

export function localizedProLookLabel(look: ProLook, t: LocalizationController["t"]): string {
  return look.kind === "icon" ? t(APP_ICON_LABEL_KEYS[look.id]) : localizedPetCoatLabel(look.id, t);
}

