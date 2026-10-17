import { PET_SKIN_JA } from "../petSkinTranslations";
import type { TranslationKey } from "../translations";
import { JAPANESE_PART_1 } from "./jaPart1";
import { JAPANESE_PART_2 } from "./jaPart2";
import { JAPANESE_PART_3 } from "./jaPart3";
import { JAPANESE_PART_4 } from "./jaPart4";
import { JAPANESE_PART_5 } from "./jaPart5";
import { JAPANESE_PART_6 } from "./jaPart6";
import { JAPANESE_PART_7 } from "./jaPart7";
import { JAPANESE_PART_8 } from "./jaPart8";
import { JAPANESE_PART_9 } from "./jaPart9";
import { JAPANESE_PART_10 } from "./jaPart10";
import { JAPANESE_PART_11 } from "./jaPart11";
import { JAPANESE_PART_12 } from "./jaPart12";
import { JAPANESE_PART_13 } from "./jaPart13";
import { JAPANESE_PART_14 } from "./jaPart14";
import { JAPANESE_PART_15 } from "./jaPart15";

export const JAPANESE_TRANSLATIONS = {
  ...PET_SKIN_JA,
  ...JAPANESE_PART_1,
  ...JAPANESE_PART_2,
  ...JAPANESE_PART_3,
  ...JAPANESE_PART_4,
  ...JAPANESE_PART_5,
  ...JAPANESE_PART_6,
  ...JAPANESE_PART_7,
  ...JAPANESE_PART_8,
  ...JAPANESE_PART_9,
  ...JAPANESE_PART_10,
  ...JAPANESE_PART_11,
  ...JAPANESE_PART_12,
  ...JAPANESE_PART_13,
  ...JAPANESE_PART_14,
  ...JAPANESE_PART_15,
} satisfies Record<TranslationKey, string>;
