/** Copy for the date navigator's month picker (components/DateJumpCalendar.tsx). */
export const DATE_NAVIGATOR_EN = {
  "dateNavigator.chooseDay": "Go to a day",
  "dateNavigator.chooseWeek": "Go to a week",
  "dateNavigator.openDay": "{{date}}, go to another day",
  "dateNavigator.openWeek": "{{date}}, go to another week",
  "dateNavigator.previousMonth": "Previous month",
  "dateNavigator.nextMonth": "Next month",
} as const;

type DateNavigatorKey = keyof typeof DATE_NAVIGATOR_EN;

export const DATE_NAVIGATOR_KO: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "날짜로 이동",
  "dateNavigator.chooseWeek": "주로 이동",
  "dateNavigator.openDay": "{{date}}, 다른 날짜로 이동",
  "dateNavigator.openWeek": "{{date}}, 다른 주로 이동",
  "dateNavigator.previousMonth": "이전 달",
  "dateNavigator.nextMonth": "다음 달",
};

export const DATE_NAVIGATOR_ES: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "Ir a un día",
  "dateNavigator.chooseWeek": "Ir a una semana",
  "dateNavigator.openDay": "{{date}}, ir a otro día",
  "dateNavigator.openWeek": "{{date}}, ir a otra semana",
  "dateNavigator.previousMonth": "Mes anterior",
  "dateNavigator.nextMonth": "Mes siguiente",
};

export const DATE_NAVIGATOR_DE: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "Zu einem Tag springen",
  "dateNavigator.chooseWeek": "Zu einer Woche springen",
  "dateNavigator.openDay": "{{date}}, zu einem anderen Tag springen",
  "dateNavigator.openWeek": "{{date}}, zu einer anderen Woche springen",
  "dateNavigator.previousMonth": "Vorheriger Monat",
  "dateNavigator.nextMonth": "Nächster Monat",
};

export const DATE_NAVIGATOR_FR: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "Aller à un jour",
  "dateNavigator.chooseWeek": "Aller à une semaine",
  "dateNavigator.openDay": "{{date}}, aller à un autre jour",
  "dateNavigator.openWeek": "{{date}}, aller à une autre semaine",
  "dateNavigator.previousMonth": "Mois précédent",
  "dateNavigator.nextMonth": "Mois suivant",
};

export const DATE_NAVIGATOR_JA: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "日付へ移動",
  "dateNavigator.chooseWeek": "週へ移動",
  "dateNavigator.openDay": "{{date}}、別の日へ移動",
  "dateNavigator.openWeek": "{{date}}、別の週へ移動",
  "dateNavigator.previousMonth": "前の月",
  "dateNavigator.nextMonth": "次の月",
};

export const DATE_NAVIGATOR_PTBR: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "Ir para um dia",
  "dateNavigator.chooseWeek": "Ir para uma semana",
  "dateNavigator.openDay": "{{date}}, ir para outro dia",
  "dateNavigator.openWeek": "{{date}}, ir para outra semana",
  "dateNavigator.previousMonth": "Mês anterior",
  "dateNavigator.nextMonth": "Próximo mês",
};

export const DATE_NAVIGATOR_ZHHANS: Record<DateNavigatorKey, string> = {
  "dateNavigator.chooseDay": "跳转到某一天",
  "dateNavigator.chooseWeek": "跳转到某一周",
  "dateNavigator.openDay": "{{date}}，跳转到其他日期",
  "dateNavigator.openWeek": "{{date}}，跳转到其他周",
  "dateNavigator.previousMonth": "上个月",
  "dateNavigator.nextMonth": "下个月",
};
