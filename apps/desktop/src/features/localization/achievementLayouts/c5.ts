/** Strings of layout c5 (layouts/c5); same shape as c1.ts. */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  "achievements.c5.medalsAhead": "Medals to earn",
  "achievements.c5.groupsOne": "New medals in one group",
  "achievements.c5.groupsMany": "New medals in {{count}} groups",
};

export const C5_STRINGS: LayoutStrings<"c5", typeof en> = {
  en,
  ko: {
    "achievements.c5.medalsAhead": "얻을 수 있는 메달",
    "achievements.c5.groupsOne": "한 그룹에 새 메달이 들어왔어요",
    "achievements.c5.groupsMany": "{{count}}개 그룹에 새 메달이 들어왔어요",
  },
  es: {
    "achievements.c5.medalsAhead": "Medallas por ganar",
    "achievements.c5.groupsOne": "Medallas nuevas en un grupo",
    "achievements.c5.groupsMany": "Medallas nuevas en {{count}} grupos",
  },
  de: {
    "achievements.c5.medalsAhead": "Mögliche Medaillen",
    "achievements.c5.groupsOne": "Neue Medaillen in einer Gruppe",
    "achievements.c5.groupsMany": "Neue Medaillen in {{count}} Gruppen",
  },
  fr: {
    "achievements.c5.medalsAhead": "Médailles à obtenir",
    "achievements.c5.groupsOne": "Nouvelles médailles dans un groupe",
    "achievements.c5.groupsMany": "Nouvelles médailles dans {{count}} groupes",
  },
  ja: {
    "achievements.c5.medalsAhead": "獲得できるメダル",
    "achievements.c5.groupsOne": "1つのグループに新しいメダル",
    "achievements.c5.groupsMany": "{{count}}つのグループに新しいメダル",
  },
  ptBR: {
    "achievements.c5.medalsAhead": "Medalhas a conquistar",
    "achievements.c5.groupsOne": "Medalhas novas em um grupo",
    "achievements.c5.groupsMany": "Medalhas novas em {{count}} grupos",
  },
  zhHans: {
    "achievements.c5.medalsAhead": "可获得的奖牌",
    "achievements.c5.groupsOne": "新奖牌来自 1 个分组",
    "achievements.c5.groupsMany": "新奖牌来自 {{count}} 个分组",
  },
};
