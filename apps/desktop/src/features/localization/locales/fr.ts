import type { TranslationKey } from "../translations";
import { FRENCH_PART_1 } from "./frPart1";
import { FRENCH_PART_2 } from "./frPart2";
import { FRENCH_PART_3 } from "./frPart3";
import { FRENCH_PART_4 } from "./frPart4";
import { FRENCH_PART_5 } from "./frPart5";
import { FRENCH_PART_6 } from "./frPart6";
import { FRENCH_PART_7 } from "./frPart7";
import { FRENCH_PART_8 } from "./frPart8";
import { FRENCH_PART_9 } from "./frPart9";
import { FRENCH_PART_10 } from "./frPart10";
import { FRENCH_PART_11 } from "./frPart11";
import { FRENCH_PART_12 } from "./frPart12";
import { FRENCH_PART_13 } from "./frPart13";
import { FRENCH_PART_14 } from "./frPart14";
import { FRENCH_PART_15 } from "./frPart15";

export const FRENCH_TRANSLATIONS = {
  ...FRENCH_PART_1,
  ...FRENCH_PART_2,
  ...FRENCH_PART_3,
  ...FRENCH_PART_4,
  ...FRENCH_PART_5,
  ...FRENCH_PART_6,
  ...FRENCH_PART_7,
  ...FRENCH_PART_8,
  ...FRENCH_PART_9,
  ...FRENCH_PART_10,
  ...FRENCH_PART_11,
  ...FRENCH_PART_12,
  ...FRENCH_PART_13,
  ...FRENCH_PART_14,
  ...FRENCH_PART_15,
} satisfies Record<TranslationKey, string>;
