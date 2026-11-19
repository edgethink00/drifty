import { CLI_PILOT_ES } from "./cliPilotTranslations";
import { SCREEN_CONTEXT_ES } from "./screenContextTranslations";
import { TEAM_POLICY_ES } from "./teamPolicyTranslations";
import { TEAM_EMAIL_INVITE_ES } from "./teamEmailInviteTranslations";
import { PET_SKIN_ES } from "./petSkinTranslations";
import { PET_NAME_ES } from "./petNameTranslations";
import { FEEDBACK_REQUESTS_ES } from "./feedbackRequestTranslations";
import { FOCUS_SESSION_ES } from "./focusSessionTranslations";
import { PERSONAL_API_ES } from "./personalApiTranslations";
import { DATE_NAVIGATOR_ES } from "./dateNavigatorTranslations";
import { CUSTOM_ENDPOINT_ES } from "./customEndpointTranslations";
import type { TranslationKey } from "./translations";
import { SPANISH_PART_1 } from "./spanishPart1";
import { SPANISH_PART_2 } from "./spanishPart2";
import { SPANISH_PART_3 } from "./spanishPart3";
import { SPANISH_PART_4 } from "./spanishPart4";
import { SPANISH_PART_5 } from "./spanishPart5";

export const SPANISH_TRANSLATIONS = {
  ...CLI_PILOT_ES,
  "settings.ai.connectionTitle": "Conexión de IA",
  "settings.ai.localProvider": "IA local",
  "settings.ai.taskConnections": "Dónde se procesa la IA",
  "settings.ai.openAiSettingsAria": "Ajustes de OpenAI",
  "settings.ai.anthropicSettingsAria": "Ajustes de Anthropic",
  "settings.ai.localResourceDetails": "Uso de recursos del dispositivo",
  "settings.ai.intelligenceTasks": "Proyectos y títulos de día/semana",
  "settings.ai.localQuality": "Los modelos locales pequeños pueden clasificar mal las actividades o confundir proyectos y títulos.",
  "settings.ai.advancedIntelligence": "Modelo para proyectos y títulos",
  "settings.ai.sharedDefault": "Usar la conexión de IA predeterminada",
  "settings.ai.sharedDefaultBody": "Activa esta opción para usar la conexión de arriba en proyectos y títulos. Esta configuración independiente se eliminará.",
  ...PET_SKIN_ES,
  ...PET_NAME_ES,
  ...SCREEN_CONTEXT_ES,
  ...TEAM_POLICY_ES,
  ...TEAM_EMAIL_INVITE_ES,
  ...FEEDBACK_REQUESTS_ES,
  ...FOCUS_SESSION_ES,
  ...PERSONAL_API_ES,
  ...DATE_NAVIGATOR_ES,
  ...CUSTOM_ENDPOINT_ES,
  ...SPANISH_PART_1,
  ...SPANISH_PART_2,
  ...SPANISH_PART_3,
  ...SPANISH_PART_4,
  ...SPANISH_PART_5,
} satisfies Record<TranslationKey, string>;
