/** Copy for the optional Mac Calendar overlay (EventKit) in Settings and Week. */
export const MAC_CALENDAR_EN = {
  "settings.macCalendar.section": "Calendar",
  "settings.macCalendar.title": "macOS Calendar",
  "settings.macCalendar.description": "Show events from the calendars in macOS Calendar, such as iCloud, Google and Outlook, in Week. Titles and times stay on this computer and are not counted as tracked time.",
  "settings.macCalendar.denied": "Drifty can’t read your calendars. Allow it in System Settings › Privacy & Security › Calendars.",
  "settings.macCalendar.restricted": "Calendar access is restricted on this computer.",
  "settings.macCalendar.writeOnly": "Drifty can only add events, not read them. Allow full access in System Settings.",
  "settings.macCalendar.failed": "macOS Calendar could not be turned on. Please try again.",
  "settings.macCalendar.openSettings": "Open System Settings",
  "dashboard.week.calendarPlanned": "Calendar · planned",
} as const;

type MacCalendarKey = keyof typeof MAC_CALENDAR_EN;

export const MAC_CALENDAR_KO: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "캘린더",
  "settings.macCalendar.title": "macOS 캘린더",
  "settings.macCalendar.description": "macOS 캘린더에 추가한 iCloud, Google, Outlook 등의 일정을 Week에 표시합니다. 제목과 시간은 이 컴퓨터에만 머물며 추적 시간에 포함되지 않습니다.",
  "settings.macCalendar.denied": "Drifty가 캘린더를 읽을 수 없습니다. 시스템 설정 › 개인정보 보호 및 보안 › 캘린더에서 허용해 주세요.",
  "settings.macCalendar.restricted": "이 컴퓨터에서는 캘린더 접근이 제한되어 있습니다.",
  "settings.macCalendar.writeOnly": "Drifty에 일정 추가 권한만 있습니다. 시스템 설정에서 전체 접근을 허용해 주세요.",
  "settings.macCalendar.failed": "macOS 캘린더를 켜지 못했습니다. 다시 시도해 주세요.",
  "settings.macCalendar.openSettings": "시스템 설정 열기",
  "dashboard.week.calendarPlanned": "캘린더 · 예정",
};

export const MAC_CALENDAR_ES: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "Calendario",
  "settings.macCalendar.title": "Calendario de macOS",
  "settings.macCalendar.description": "Muestra en Semana los eventos de los calendarios de Calendario de macOS, como iCloud, Google y Outlook. Los títulos y horas se quedan en este ordenador y no cuentan como tiempo registrado.",
  "settings.macCalendar.denied": "Drifty no puede leer tus calendarios. Permítelo en Ajustes del Sistema › Privacidad y seguridad › Calendarios.",
  "settings.macCalendar.restricted": "El acceso a los calendarios está restringido en este ordenador.",
  "settings.macCalendar.writeOnly": "Drifty solo puede añadir eventos, no leerlos. Permite el acceso completo en Ajustes del Sistema.",
  "settings.macCalendar.failed": "No se pudo activar Calendario de macOS. Inténtalo de nuevo.",
  "settings.macCalendar.openSettings": "Abrir Ajustes del Sistema",
  "dashboard.week.calendarPlanned": "Calendario · previsto",
};

export const MAC_CALENDAR_DE: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "Kalender",
  "settings.macCalendar.title": "macOS-Kalender",
  "settings.macCalendar.description": "Zeigt Termine aus den Kalendern in macOS Kalender, etwa iCloud, Google und Outlook, in der Woche an. Titel und Zeiten bleiben auf diesem Computer und zählen nicht als erfasste Zeit.",
  "settings.macCalendar.denied": "Drifty kann deine Kalender nicht lesen. Erlaube es unter Systemeinstellungen › Datenschutz & Sicherheit › Kalender.",
  "settings.macCalendar.restricted": "Der Kalenderzugriff ist auf diesem Computer eingeschränkt.",
  "settings.macCalendar.writeOnly": "Drifty kann nur Termine hinzufügen, aber nicht lesen. Erlaube den vollen Zugriff in den Systemeinstellungen.",
  "settings.macCalendar.failed": "macOS-Kalender konnte nicht aktiviert werden. Bitte versuche es erneut.",
  "settings.macCalendar.openSettings": "Systemeinstellungen öffnen",
  "dashboard.week.calendarPlanned": "Kalender · geplant",
};

export const MAC_CALENDAR_FR: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "Calendrier",
  "settings.macCalendar.title": "Calendrier macOS",
  "settings.macCalendar.description": "Affiche dans Semaine les événements des calendriers de l’app Calendrier de macOS, comme iCloud, Google et Outlook. Les titres et horaires restent sur cet ordinateur et ne comptent pas comme temps suivi.",
  "settings.macCalendar.denied": "Drifty ne peut pas lire vos calendriers. Autorisez-le dans Réglages Système › Confidentialité et sécurité › Calendriers.",
  "settings.macCalendar.restricted": "L’accès aux calendriers est restreint sur cet ordinateur.",
  "settings.macCalendar.writeOnly": "Drifty peut seulement ajouter des événements, pas les lire. Autorisez l’accès complet dans Réglages Système.",
  "settings.macCalendar.failed": "Impossible d’activer Calendrier macOS. Réessayez.",
  "settings.macCalendar.openSettings": "Ouvrir Réglages Système",
  "dashboard.week.calendarPlanned": "Calendrier · prévu",
};

export const MAC_CALENDAR_JA: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "カレンダー",
  "settings.macCalendar.title": "macOSカレンダー",
  "settings.macCalendar.description": "macOSのカレンダーに追加したiCloud、Google、Outlookなどの予定を週に表示します。タイトルと時刻はこのコンピュータにとどまり、記録時間には含まれません。",
  "settings.macCalendar.denied": "Driftyはカレンダーを読み取れません。システム設定 › プライバシーとセキュリティ › カレンダーで許可してください。",
  "settings.macCalendar.restricted": "このコンピュータではカレンダーへのアクセスが制限されています。",
  "settings.macCalendar.writeOnly": "Driftyは予定の追加のみ許可されており、読み取れません。システム設定でフルアクセスを許可してください。",
  "settings.macCalendar.failed": "macOSカレンダーをオンにできませんでした。もう一度お試しください。",
  "settings.macCalendar.openSettings": "システム設定を開く",
  "dashboard.week.calendarPlanned": "カレンダー · 予定",
};

export const MAC_CALENDAR_PTBR: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "Calendário",
  "settings.macCalendar.title": "Calendário do macOS",
  "settings.macCalendar.description": "Mostra na Semana os eventos dos calendários do app Calendário do macOS, como iCloud, Google e Outlook. Títulos e horários ficam neste computador e não contam como tempo registrado.",
  "settings.macCalendar.denied": "O Drifty não consegue ler seus calendários. Permita em Ajustes do Sistema › Privacidade e Segurança › Calendários.",
  "settings.macCalendar.restricted": "O acesso aos calendários está restrito neste computador.",
  "settings.macCalendar.writeOnly": "O Drifty só pode adicionar eventos, não lê-los. Permita o acesso total em Ajustes do Sistema.",
  "settings.macCalendar.failed": "Não foi possível ativar o Calendário do macOS. Tente novamente.",
  "settings.macCalendar.openSettings": "Abrir Ajustes do Sistema",
  "dashboard.week.calendarPlanned": "Calendário · previsto",
};

export const MAC_CALENDAR_ZHHANS: Record<MacCalendarKey, string> = {
  "settings.macCalendar.section": "日历",
  "settings.macCalendar.title": "macOS 日历",
  "settings.macCalendar.description": "在“周”中显示 macOS 日历里添加的 iCloud、Google、Outlook 等日历的日程。标题和时间只保留在这台电脑上，不计入记录时间。",
  "settings.macCalendar.denied": "Drifty 无法读取你的日历。请在系统设置 › 隐私与安全性 › 日历中允许。",
  "settings.macCalendar.restricted": "这台电脑限制了日历访问。",
  "settings.macCalendar.writeOnly": "Drifty 只能添加日程，无法读取。请在系统设置中允许完全访问。",
  "settings.macCalendar.failed": "无法开启 macOS 日历，请重试。",
  "settings.macCalendar.openSettings": "打开系统设置",
  "dashboard.week.calendarPlanned": "日历 · 计划",
};
