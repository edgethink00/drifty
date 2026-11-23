import type { LayoutStrings } from "./layoutStrings";

const en = {
  "achievements.c2.rarityHead": "Of Drifty users",
  "achievements.c2.rarityFew": "{{count}} of {{basis}}",
  "achievements.c2.rarityShare": "{{percent}}%",
  "achievements.c2.medalsAhead": "Medals to earn",
};

export const C2_STRINGS: LayoutStrings<"c2", typeof en> = {
  en,
  ko: {
    "achievements.c2.rarityHead": "Drifty 사용자 중",
    "achievements.c2.rarityFew": "{{basis}}명 중 {{count}}명",
    "achievements.c2.rarityShare": "{{percent}}%",
    "achievements.c2.medalsAhead": "받을 수 있는 메달",
  },
  es: {
    "achievements.c2.rarityHead": "Entre usuarios de Drifty",
    "achievements.c2.rarityFew": "{{count}} de {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} %",
    "achievements.c2.medalsAhead": "Medallas por ganar",
  },
  de: {
    "achievements.c2.rarityHead": "Unter Drifty-Nutzern",
    "achievements.c2.rarityFew": "{{count}} von {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} %",
    "achievements.c2.medalsAhead": "Erreichbare Medaillen",
  },
  fr: {
    "achievements.c2.rarityHead": "Parmi les utilisateurs",
    "achievements.c2.rarityFew": "{{count}} sur {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} %",
    "achievements.c2.medalsAhead": "Médailles à gagner",
  },
  ja: {
    "achievements.c2.rarityHead": "Driftyユーザーのうち",
    "achievements.c2.rarityFew": "{{basis}}人中{{count}}人",
    "achievements.c2.rarityShare": "{{percent}}%",
    "achievements.c2.medalsAhead": "獲得できるメダル",
  },
  ptBR: {
    "achievements.c2.rarityHead": "Entre usuários do Drifty",
    "achievements.c2.rarityFew": "{{count}} de {{basis}}",
    "achievements.c2.rarityShare": "{{percent}}%",
    "achievements.c2.medalsAhead": "Medalhas a conquistar",
  },
  zhHans: {
    "achievements.c2.rarityHead": "Drifty 用户中",
    "achievements.c2.rarityFew": "{{basis}} 人中 {{count}} 人",
    "achievements.c2.rarityShare": "{{percent}}%",
    "achievements.c2.medalsAhead": "可获得的奖牌",
  },
};
