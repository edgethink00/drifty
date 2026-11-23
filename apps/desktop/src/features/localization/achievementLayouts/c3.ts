/** Strings of layout c3 (layouts/c3); same shape as c1.ts. */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  "achievements.c3.intro.focus": "How long you stay with one thing",
  "achievements.c3.intro.rhythm": "When in the day and the week you work",
  "achievements.c3.intro.consistency": "How steadily you keep going",
  "achievements.c3.intro.unexpected": "Days unlike the others",
  "achievements.c3.chapterCount": "{{earned}} of {{total}} in {{group}}",
};

export const C3_STRINGS: LayoutStrings<"c3", typeof en> = {
  en,
  ko: {
    "achievements.c3.intro.focus": "한 번에 얼마나 오래 머무는지",
    "achievements.c3.intro.rhythm": "하루와 한 주의 어느 때에 일하는지",
    "achievements.c3.intro.consistency": "얼마나 꾸준히 이어 가는지",
    "achievements.c3.intro.unexpected": "평소와 다르게 흘러간 날",
    "achievements.c3.chapterCount": "{{group}} {{total}}개 중 {{earned}}개",
  },
  es: {
    "achievements.c3.intro.focus": "Cuánto tiempo sigues con una sola cosa",
    "achievements.c3.intro.rhythm": "En qué momento del día y de la semana trabajas",
    "achievements.c3.intro.consistency": "Con qué constancia sigues adelante",
    "achievements.c3.intro.unexpected": "Días distintos a los demás",
    "achievements.c3.chapterCount": "{{earned}} de {{total}} en {{group}}",
  },
  de: {
    "achievements.c3.intro.focus": "Wie lange du bei einer Sache bleibst",
    "achievements.c3.intro.rhythm": "Wann am Tag und in der Woche du arbeitest",
    "achievements.c3.intro.consistency": "Wie beständig du dranbleibst",
    "achievements.c3.intro.unexpected": "Tage, die anders verlaufen sind",
    "achievements.c3.chapterCount": "{{earned}} von {{total}} in {{group}}",
  },
  fr: {
    "achievements.c3.intro.focus": "Combien de temps vous restez sur une même chose",
    "achievements.c3.intro.rhythm": "À quel moment du jour et de la semaine vous travaillez",
    "achievements.c3.intro.consistency": "Avec quelle régularité vous continuez",
    "achievements.c3.intro.unexpected": "Des journées pas comme les autres",
    "achievements.c3.chapterCount": "{{earned}} sur {{total}} dans {{group}}",
  },
  ja: {
    "achievements.c3.intro.focus": "ひとつのことにどれだけ長く向き合えたか",
    "achievements.c3.intro.rhythm": "一日と一週間のどの時間に作業しているか",
    "achievements.c3.intro.consistency": "どれだけ続けられているか",
    "achievements.c3.intro.unexpected": "いつもと違った一日",
    "achievements.c3.chapterCount": "{{group}} {{total}}個中 {{earned}}個",
  },
  ptBR: {
    "achievements.c3.intro.focus": "Quanto tempo você fica em uma coisa só",
    "achievements.c3.intro.rhythm": "Em que hora do dia e da semana você trabalha",
    "achievements.c3.intro.consistency": "Com que constância você segue em frente",
    "achievements.c3.intro.unexpected": "Dias diferentes dos outros",
    "achievements.c3.chapterCount": "{{earned}} de {{total}} em {{group}}",
  },
  zhHans: {
    "achievements.c3.intro.focus": "一次能专注多久",
    "achievements.c3.intro.rhythm": "你在一天和一周的什么时候工作",
    "achievements.c3.intro.consistency": "你坚持得有多稳定",
    "achievements.c3.intro.unexpected": "与平常不同的日子",
    "achievements.c3.chapterCount": "{{group}} {{total}} 个中的 {{earned}} 个",
  },
};
