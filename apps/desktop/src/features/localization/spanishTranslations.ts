import { PET_SKIN_ES } from "./petSkinTranslations";
import type { TranslationKey } from "./translations";
import { SPANISH_PART_1 } from "./spanishPart1";
import { SPANISH_PART_2 } from "./spanishPart2";
import { SPANISH_PART_3 } from "./spanishPart3";
import { SPANISH_PART_4 } from "./spanishPart4";
import { SPANISH_PART_5 } from "./spanishPart5";

export const SPANISH_TRANSLATIONS = {
  ...PET_SKIN_ES,
  ...SPANISH_PART_1,
  ...SPANISH_PART_2,
  ...SPANISH_PART_3,
  ...SPANISH_PART_4,
  ...SPANISH_PART_5,
} satisfies Record<TranslationKey, string>;
