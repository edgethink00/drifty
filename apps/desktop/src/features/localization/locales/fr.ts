import { PET_SKIN_FR } from "../petSkinTranslations";
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
  "settings.ai.connectionTitle": "Connexion IA",
  "settings.ai.localProvider": "IA locale",
  "settings.ai.taskConnections": "Lieu de traitement par fonction",
  "settings.ai.localResourceDetails": "Utilisation des ressources de l’appareil",
  "settings.ai.intelligenceTasks": "Projets et titres du jour/de la semaine",
  "settings.ai.localQuality": "Les petits modèles locaux peuvent mal classer les activités ou confondre les projets et les titres.",
  "settings.ai.advancedIntelligence": "Modèle pour les projets et les titres",
  "settings.ai.sharedDefault": "Utiliser la connexion IA par défaut",
  "settings.ai.sharedDefaultBody": "Les projets et les titres utilisent la connexion ci-dessus. Désactivez cette option pour choisir un autre modèle pour ces fonctions.",
  ...PET_SKIN_FR,
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
