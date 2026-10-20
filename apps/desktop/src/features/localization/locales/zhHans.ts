import { PET_SKIN_ZHHANS } from "../petSkinTranslations";
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
  "settings.ai.connectionTitle": "AI 连接",
  "settings.ai.localProvider": "本地 AI",
  "settings.ai.taskConnections": "各功能的 AI 处理位置",
  "settings.ai.localResourceDetails": "设备资源使用说明",
  "settings.ai.intelligenceTasks": "项目与日/周任务名称",
  "settings.ai.localQuality": "小型本地模型可能分类错误，或混淆项目和任务名称。",
  "settings.ai.advancedIntelligence": "项目与任务名称模型设置",
  "settings.ai.sharedDefault": "使用默认 AI 连接",
  "settings.ai.sharedDefaultBody": "项目和任务名称使用上方连接。关闭后可为这些功能选择其他模型。",
  ...PET_SKIN_ZHHANS,
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
