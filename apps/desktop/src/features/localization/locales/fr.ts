import { CLI_FR } from "../cliTranslations";
import { SCREEN_CONTEXT_FR } from "../screenContextTranslations";
import { TEAM_POLICY_FR } from "../teamPolicyTranslations";
import { TEAM_EMAIL_INVITE_FR } from "../teamEmailInviteTranslations";
import { PET_SKIN_FR } from "../petSkinTranslations";
import { PET_NAME_FR } from "../petNameTranslations";
import { FEEDBACK_REQUESTS_FR } from "../feedbackRequestTranslations";
import { FOCUS_SESSION_FR } from "../focusSessionTranslations";
import { PERSONAL_API_FR } from "../personalApiTranslations";
import { DATE_NAVIGATOR_FR } from "../dateNavigatorTranslations";
import { CUSTOM_ENDPOINT_FR } from "../customEndpointTranslations";
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
import { FRENCH_PART_16 } from "./frPart16";

export const FRENCH_TRANSLATIONS = {
  ...CLI_FR,
  "settings.ai.connectionTitle": "Connexion IA",
  "settings.ai.localProvider": "IA locale",
  "settings.ai.taskConnections": "Lieu de traitement par fonction",
  "settings.ai.openAiSettingsAria": "Paramètres OpenAI",
  "settings.ai.anthropicSettingsAria": "Paramètres Anthropic",
  "settings.ai.localResourceDetails": "Utilisation des ressources de l’appareil",
  "settings.ai.intelligenceTasks": "Projets et titres du jour/de la semaine",
  "settings.ai.localQuality": "Les petits modèles locaux peuvent mal classer les activités ou confondre les projets et les titres.",
  "settings.ai.advancedIntelligence": "Modèle pour les projets et les titres",
  "settings.ai.sharedDefault": "Utiliser la connexion IA par défaut",
  "settings.ai.sharedDefaultBody": "Activez cette option pour utiliser la connexion ci-dessus pour les projets et les titres. Ce réglage distinct sera supprimé.",
  ...PET_SKIN_FR,
  ...PET_NAME_FR,
  ...SCREEN_CONTEXT_FR,
  ...TEAM_POLICY_FR,
  ...TEAM_EMAIL_INVITE_FR,
  ...FEEDBACK_REQUESTS_FR,
  ...FOCUS_SESSION_FR,
  ...PERSONAL_API_FR,
  ...DATE_NAVIGATOR_FR,
  ...CUSTOM_ENDPOINT_FR,
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
  ...FRENCH_PART_16,
  "dashboard.today.laneActivity": "Activités",
  "dashboard.today.laneWorkLog": "Journal de travail",
  "dashboard.today.laneTasks": "Tâches",
  "dashboard.today.laneRecorded": "Temps enregistré",
  "dashboard.today.laneByTask": "Par tâche",
} satisfies Record<TranslationKey, string>;
