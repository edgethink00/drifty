import { CLI_DE } from "../cliTranslations";
import { SCREEN_CONTEXT_DE } from "../screenContextTranslations";
import { TEAM_POLICY_DE } from "../teamPolicyTranslations";
import { TEAM_EMAIL_INVITE_DE } from "../teamEmailInviteTranslations";
import { PET_SKIN_DE } from "../petSkinTranslations";
import { PET_NAME_DE } from "../petNameTranslations";
import { FEEDBACK_REQUESTS_DE } from "../feedbackRequestTranslations";
import { FOCUS_SESSION_DE } from "../focusSessionTranslations";
import { ACHIEVEMENTS_DE } from "../achievementTranslations";
import { PERSONAL_API_DE } from "../personalApiTranslations";
import { DATE_NAVIGATOR_DE } from "../dateNavigatorTranslations";
import { CUSTOM_ENDPOINT_DE } from "../customEndpointTranslations";
import type { TranslationKey } from "../translations";
import { GERMAN_PART_1 } from "./dePart1";
import { GERMAN_PART_2 } from "./dePart2";
import { GERMAN_PART_3 } from "./dePart3";
import { GERMAN_PART_4 } from "./dePart4";
import { GERMAN_PART_5 } from "./dePart5";
import { GERMAN_PART_6 } from "./dePart6";
import { GERMAN_PART_7 } from "./dePart7";
import { GERMAN_PART_8 } from "./dePart8";
import { GERMAN_PART_9 } from "./dePart9";
import { GERMAN_PART_10 } from "./dePart10";
import { GERMAN_PART_11 } from "./dePart11";
import { GERMAN_PART_12 } from "./dePart12";
import { GERMAN_PART_13 } from "./dePart13";
import { GERMAN_PART_14 } from "./dePart14";
import { GERMAN_PART_15 } from "./dePart15";
import { GERMAN_PART_16 } from "./dePart16";

export const GERMAN_TRANSLATIONS = {
  ...CLI_DE,
  "settings.ai.connectionTitle": "KI-Verbindung",
  "settings.ai.localProvider": "Lokale KI",
  "settings.ai.taskConnections": "KI-Verarbeitung je Funktion",
  "settings.ai.openAiSettingsAria": "OpenAI-Einstellungen",
  "settings.ai.anthropicSettingsAria": "Anthropic-Einstellungen",
  "settings.ai.localResourceDetails": "Ressourcennutzung des Geräts",
  "settings.ai.intelligenceTasks": "Projekte und Tages-/Wochentitel",
  "settings.ai.localQuality": "Kleine lokale Modelle können Aktivitäten falsch zuordnen oder Projekte und Titel verwechseln.",
  "settings.ai.advancedIntelligence": "Modelleinstellungen für Projekte und Titel",
  "settings.ai.sharedDefault": "Standard-KI-Verbindung verwenden",
  "settings.ai.sharedDefaultBody": "Aktiviere dies, um die Verbindung oben für Projekte und Titel zu verwenden. Diese separate Einstellung wird dann entfernt.",
  ...PET_SKIN_DE,
  ...PET_NAME_DE,
  ...SCREEN_CONTEXT_DE,
  ...TEAM_POLICY_DE,
  ...TEAM_EMAIL_INVITE_DE,
  ...FEEDBACK_REQUESTS_DE,
  ...FOCUS_SESSION_DE,
  ...ACHIEVEMENTS_DE,
  ...PERSONAL_API_DE,
  ...DATE_NAVIGATOR_DE,
  ...CUSTOM_ENDPOINT_DE,
  ...GERMAN_PART_1,
  ...GERMAN_PART_2,
  ...GERMAN_PART_3,
  ...GERMAN_PART_4,
  ...GERMAN_PART_5,
  ...GERMAN_PART_6,
  ...GERMAN_PART_7,
  ...GERMAN_PART_8,
  ...GERMAN_PART_9,
  ...GERMAN_PART_10,
  ...GERMAN_PART_11,
  ...GERMAN_PART_12,
  ...GERMAN_PART_13,
  ...GERMAN_PART_14,
  ...GERMAN_PART_15,
  ...GERMAN_PART_16,
  "dashboard.today.laneActivity": "Aktivitäten",
  "dashboard.today.laneWorkLog": "Arbeitsjournal",
  "dashboard.today.laneTasks": "Aufgaben",
  "dashboard.today.laneRecorded": "Erfasst",
  "dashboard.today.laneByTask": "Nach Aufgabe",
} satisfies Record<TranslationKey, string>;
