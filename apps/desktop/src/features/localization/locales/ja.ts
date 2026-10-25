import { PET_SKIN_JA } from "../petSkinTranslations";
import { FEEDBACK_REQUESTS_JA } from "../feedbackRequestTranslations";
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
  "settings.ai.connectionTitle": "AI接続",
  "settings.ai.localProvider": "ローカルAI",
  "settings.ai.taskConnections": "機能ごとのAI処理先",
  "settings.ai.openAiSettingsAria": "OpenAIの設定",
  "settings.ai.anthropicSettingsAria": "Anthropicの設定",
  "settings.ai.localResourceDetails": "デバイスのリソース使用について",
  "settings.ai.intelligenceTasks": "プロジェクトと日・週の作業名",
  "settings.ai.localQuality": "小型ローカルモデルでは、分類・プロジェクトの判断や作業名が不正確になる場合があります。",
  "settings.ai.advancedIntelligence": "プロジェクト・作業名のモデル設定",
  "settings.ai.sharedDefault": "既定のAI接続を使用",
  "settings.ai.sharedDefaultBody": "プロジェクトと作業名に上の接続を使用します。オンにすると、この個別設定は削除されます。",
  ...PET_SKIN_JA,
  ...FEEDBACK_REQUESTS_JA,
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
  "dashboard.today.laneActivity": "活動記録",
  "dashboard.today.laneWorkLog": "作業ログ",
  "dashboard.today.laneTasks": "タスク",
  "dashboard.today.laneRecorded": "記録",
  "dashboard.today.laneByTask": "タスク別",
} satisfies Record<TranslationKey, string>;
