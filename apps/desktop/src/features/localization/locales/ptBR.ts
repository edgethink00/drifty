import { PET_SKIN_PTBR } from "../petSkinTranslations";
import type { TranslationKey } from "../translations";
import { BRAZILIAN_PORTUGUESE_PART_1 } from "./ptBRPart1";
import { BRAZILIAN_PORTUGUESE_PART_2 } from "./ptBRPart2";
import { BRAZILIAN_PORTUGUESE_PART_3 } from "./ptBRPart3";
import { BRAZILIAN_PORTUGUESE_PART_4 } from "./ptBRPart4";
import { BRAZILIAN_PORTUGUESE_PART_5 } from "./ptBRPart5";
import { BRAZILIAN_PORTUGUESE_PART_6 } from "./ptBRPart6";
import { BRAZILIAN_PORTUGUESE_PART_7 } from "./ptBRPart7";
import { BRAZILIAN_PORTUGUESE_PART_8 } from "./ptBRPart8";
import { BRAZILIAN_PORTUGUESE_PART_9 } from "./ptBRPart9";
import { BRAZILIAN_PORTUGUESE_PART_10 } from "./ptBRPart10";
import { BRAZILIAN_PORTUGUESE_PART_11 } from "./ptBRPart11";
import { BRAZILIAN_PORTUGUESE_PART_12 } from "./ptBRPart12";
import { BRAZILIAN_PORTUGUESE_PART_13 } from "./ptBRPart13";
import { BRAZILIAN_PORTUGUESE_PART_14 } from "./ptBRPart14";
import { BRAZILIAN_PORTUGUESE_PART_15 } from "./ptBRPart15";

export const BRAZILIAN_PORTUGUESE_TRANSLATIONS = {
  "settings.ai.connectionTitle": "Conexão de IA",
  "settings.ai.localProvider": "IA local",
  "settings.ai.taskConnections": "Local de processamento por função",
  "settings.ai.openAiSettingsAria": "Configurações da OpenAI",
  "settings.ai.anthropicSettingsAria": "Configurações da Anthropic",
  "settings.ai.localResourceDetails": "Uso de recursos do dispositivo",
  "settings.ai.intelligenceTasks": "Projetos e títulos do dia/semana",
  "settings.ai.localQuality": "Modelos locais pequenos podem classificar atividades incorretamente ou confundir projetos e títulos.",
  "settings.ai.advancedIntelligence": "Modelo para projetos e títulos",
  "settings.ai.sharedDefault": "Usar a conexão de IA padrão",
  "settings.ai.sharedDefaultBody": "Ative para usar a conexão acima em projetos e títulos. Esta configuração separada será removida.",
  ...PET_SKIN_PTBR,
  ...BRAZILIAN_PORTUGUESE_PART_1,
  ...BRAZILIAN_PORTUGUESE_PART_2,
  ...BRAZILIAN_PORTUGUESE_PART_3,
  ...BRAZILIAN_PORTUGUESE_PART_4,
  ...BRAZILIAN_PORTUGUESE_PART_5,
  ...BRAZILIAN_PORTUGUESE_PART_6,
  ...BRAZILIAN_PORTUGUESE_PART_7,
  ...BRAZILIAN_PORTUGUESE_PART_8,
  ...BRAZILIAN_PORTUGUESE_PART_9,
  ...BRAZILIAN_PORTUGUESE_PART_10,
  ...BRAZILIAN_PORTUGUESE_PART_11,
  ...BRAZILIAN_PORTUGUESE_PART_12,
  ...BRAZILIAN_PORTUGUESE_PART_13,
  ...BRAZILIAN_PORTUGUESE_PART_14,
  ...BRAZILIAN_PORTUGUESE_PART_15,
} satisfies Record<TranslationKey, string>;
