import type { TranslationKey } from "../translations";
import { SIMPLIFIED_CHINESE_PART_1 } from "./zhHansPart1";
import { SIMPLIFIED_CHINESE_PART_2 } from "./zhHansPart2";
import { SIMPLIFIED_CHINESE_PART_3 } from "./zhHansPart3";
import { SIMPLIFIED_CHINESE_PART_4 } from "./zhHansPart4";
import { SIMPLIFIED_CHINESE_PART_5 } from "./zhHansPart5";
import { SIMPLIFIED_CHINESE_PART_6 } from "./zhHansPart6";
import { SIMPLIFIED_CHINESE_PART_7 } from "./zhHansPart7";
import { SIMPLIFIED_CHINESE_PART_8 } from "./zhHansPart8";
import { SIMPLIFIED_CHINESE_PART_9 } from "./zhHansPart9";
import { SIMPLIFIED_CHINESE_PART_10 } from "./zhHansPart10";
import { SIMPLIFIED_CHINESE_PART_11 } from "./zhHansPart11";
import { SIMPLIFIED_CHINESE_PART_12 } from "./zhHansPart12";
import { SIMPLIFIED_CHINESE_PART_13 } from "./zhHansPart13";
import { SIMPLIFIED_CHINESE_PART_14 } from "./zhHansPart14";
import { SIMPLIFIED_CHINESE_PART_15 } from "./zhHansPart15";

export const SIMPLIFIED_CHINESE_TRANSLATIONS = {
  ...SIMPLIFIED_CHINESE_PART_1,
  ...SIMPLIFIED_CHINESE_PART_2,
  ...SIMPLIFIED_CHINESE_PART_3,
  ...SIMPLIFIED_CHINESE_PART_4,
  ...SIMPLIFIED_CHINESE_PART_5,
  ...SIMPLIFIED_CHINESE_PART_6,
  ...SIMPLIFIED_CHINESE_PART_7,
  ...SIMPLIFIED_CHINESE_PART_8,
  ...SIMPLIFIED_CHINESE_PART_9,
  ...SIMPLIFIED_CHINESE_PART_10,
  ...SIMPLIFIED_CHINESE_PART_11,
  ...SIMPLIFIED_CHINESE_PART_12,
  ...SIMPLIFIED_CHINESE_PART_13,
  ...SIMPLIFIED_CHINESE_PART_14,
  ...SIMPLIFIED_CHINESE_PART_15,
} satisfies Record<TranslationKey, string>;
