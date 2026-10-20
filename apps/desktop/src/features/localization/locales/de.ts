import { PET_SKIN_DE } from "../petSkinTranslations";
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

export const GERMAN_TRANSLATIONS = {
  "settings.ai.connectionTitle": "KI-Verbindung",
  "settings.ai.localProvider": "Lokale KI",
  "settings.ai.taskConnections": "KI-Verarbeitung je Funktion",
  "settings.ai.localResourceDetails": "Ressourcennutzung des Geräts",
  "settings.ai.intelligenceTasks": "Projekte und Tages-/Wochentitel",
  "settings.ai.localQuality": "Kleine lokale Modelle können Aktivitäten falsch zuordnen oder Projekte und Titel verwechseln.",
  "settings.ai.advancedIntelligence": "Modelleinstellungen für Projekte und Titel",
  "settings.ai.sharedDefault": "Standard-KI-Verbindung verwenden",
  "settings.ai.sharedDefaultBody": "Projekte und Titel verwenden die Verbindung oben. Deaktiviere dies, um für diese Funktionen ein anderes Modell zu wählen.",
  ...PET_SKIN_DE,
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
} satisfies Record<TranslationKey, string>;
