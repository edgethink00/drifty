import type { LayoutStrings } from "./layoutStrings";

const en = {
  "achievements.c2.rarityHead": "Of Drifty users",
  "achievements.c2.rarityFew": "{{count}} of {{basis}}",
  "achievements.c2.rarityShare": "{{percent}}% earned",
  "achievements.c2.medalsAhead": "Medals to earn",
  "achievements.c2.fromDay": "From your day, {{day}}",
};

export const C2_STRINGS: LayoutStrings<"c2", typeof en> = {
  en,
  ko: {
    "achievements.c2.rarityHead": "Drifty 사용자 중",
    "achievements.c2.rarityFew": "{{basis}}명 중 {{count}}명",
    "achievements.c2.rarityShare": "{{percent}}% 획득",
    "achievements.c2.medalsAhead": "받을 수 있는 메달",
    "achievements.c2.fromDay": "{{day}}의 기록에서",
  },
  es: {
    "achievements.c2.rarityHead": "Entre usuarios de Drifty",
    "achievements.c2.rarityFew": "{{count}} de {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} % la tiene",
    "achievements.c2.medalsAhead": "Medallas por ganar",
    "achievements.c2.fromDay": "De tu día, {{day}}",
  },
  de: {
    "achievements.c2.rarityHead": "Unter Drifty-Nutzern",
    "achievements.c2.rarityFew": "{{count}} von {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} % haben sie",
    "achievements.c2.medalsAhead": "Erreichbare Medaillen",
    "achievements.c2.fromDay": "Aus deinem Tag, {{day}}",
  },
  fr: {
    "achievements.c2.rarityHead": "Parmi les utilisateurs",
    "achievements.c2.rarityFew": "{{count}} sur {{basis}}",
    "achievements.c2.rarityShare": "{{percent}} % l’ont",
    "achievements.c2.medalsAhead": "Médailles à gagner",
    "achievements.c2.fromDay": "De ta journée du {{day}}",
  },
  ja: {
    "achievements.c2.rarityHead": "Driftyユーザーのうち",
    "achievements.c2.rarityFew": "{{basis}}人中{{count}}人",
    "achievements.c2.rarityShare": "{{percent}}%が獲得",
    "achievements.c2.medalsAhead": "獲得できるメダル",
    "achievements.c2.fromDay": "{{day}}の記録から",
  },
  ptBR: {
    "achievements.c2.rarityHead": "Entre usuários do Drifty",
    "achievements.c2.rarityFew": "{{count}} de {{basis}}",
    "achievements.c2.rarityShare": "{{percent}}% têm",
    "achievements.c2.medalsAhead": "Medalhas a conquistar",
    "achievements.c2.fromDay": "Do seu dia, {{day}}",
  },
  zhHans: {
    "achievements.c2.rarityHead": "Drifty 用户中",
    "achievements.c2.rarityFew": "{{basis}} 人中 {{count}} 人",
    "achievements.c2.rarityShare": "{{percent}}% 已获得",
    "achievements.c2.medalsAhead": "可获得的奖牌",
    "achievements.c2.fromDay": "来自 {{day}} 的记录",
  },
};
