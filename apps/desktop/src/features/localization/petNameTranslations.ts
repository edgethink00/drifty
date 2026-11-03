import type { DisplayLanguage } from "./languageCatalog";

/*
 * Naming the desktop cat. {{petSubject}} is the cat's name as the subject of the sentence: Korean adds
 * 이/가 to fit the name (see petNameAsSubject), every other language uses the name as it is. Sentences
 * avoid he/she pronouns for the cat because the name says nothing about it.
 */
export const PET_NAME_EN = {
  "petName.popoverTitle": "What should we call this cat?",
  "petName.placeholder": "Name",
  "petName.inputLabel": "Cat name",
  "petName.ideas": "Ideas",
  "petName.previewLabel": "In alerts",
  "petName.previewEmpty": "Without a name, it’s just “the cat”.",
  "petName.later": "Later",
  "petName.confirm": "Use this name",
  "petName.rowUnnamed": "Name the cat",
  "petName.rowLabel": "Name",
  "petName.closeDescription": "{{petSubject}} closes the distracting tab or app after repeated drift. Unsaved work may be lost.",
  "petName.catCancel": "Pet {{petSubject}} on the way over to keep it open.",
  "petName.toastTitle": "{{petSubject}} closed {{closed}}",
  "petName.settingsLabel": "Name",
  "petName.settingsDescription": "Used when the cat closes a tab or app for you. Leave it empty to call it “the cat”.",
  "petName.settingsPlaceholder": "The cat",
} as const;

export const PET_NAME_KO = {
  "petName.popoverTitle": "이 고양이를 뭐라고 부를까요?",
  "petName.placeholder": "이름 입력",
  "petName.inputLabel": "고양이 이름",
  "petName.ideas": "추천",
  "petName.previewLabel": "알림에서",
  "petName.previewEmpty": "이름이 없으면 ‘고양이’라고 불러요",
  "petName.later": "나중에",
  "petName.confirm": "이 이름으로",
  "petName.rowUnnamed": "이름 짓기",
  "petName.rowLabel": "이름",
  "petName.closeDescription": "딴짓이 반복되면 {{petSubject}} 달려가 직접 닫습니다. 저장하지 않은 작업이 사라질 수 있습니다.",
  "petName.catCancel": "{{petSubject}} 다가오는 동안 만지면 닫지 않아요.",
  "petName.toastTitle": "{{petSubject}} {{closed}} 닫음",
  "petName.settingsLabel": "이름",
  "petName.settingsDescription": "고양이가 탭이나 앱을 닫을 때 이 이름으로 알려 드려요. 비워 두면 ‘고양이’라고 불러요.",
  "petName.settingsPlaceholder": "고양이",
} as const;

export const PET_NAME_ES = {
  "petName.popoverTitle": "¿Cómo llamamos a este gato?",
  "petName.placeholder": "Nombre",
  "petName.inputLabel": "Nombre del gato",
  "petName.ideas": "Ideas",
  "petName.previewLabel": "En los avisos",
  "petName.previewEmpty": "Sin nombre, será simplemente «el gato».",
  "petName.later": "Más tarde",
  "petName.confirm": "Usar este nombre",
  "petName.rowUnnamed": "Ponle nombre",
  "petName.rowLabel": "Nombre",
  "petName.closeDescription": "{{petSubject}} cierra la pestaña o la app cuando sigues distrayéndote. Podrías perder el trabajo no guardado.",
  "petName.catCancel": "Acaricia a {{petSubject}} mientras se acerca para mantenerla abierta.",
  "petName.toastTitle": "{{petSubject}} cerró {{closed}}",
  "petName.settingsLabel": "Nombre",
  "petName.settingsDescription": "Se usa cuando el gato cierra una pestaña o una app por ti. Déjalo vacío para llamarlo «el gato».",
  "petName.settingsPlaceholder": "El gato",
} as const;

export const PET_NAME_JA = {
  "petName.popoverTitle": "この猫をなんと呼びますか？",
  "petName.placeholder": "名前",
  "petName.inputLabel": "猫の名前",
  "petName.ideas": "候補",
  "petName.previewLabel": "通知では",
  "petName.previewEmpty": "名前がないときは「猫」と呼びます",
  "petName.later": "あとで",
  "petName.confirm": "この名前にする",
  "petName.rowUnnamed": "名前をつける",
  "petName.rowLabel": "名前",
  "petName.closeDescription": "気晴らしが繰り返されると、{{petSubject}}が集中を妨げるタブやアプリを閉じます。未保存の作業が失われる場合があります。",
  "petName.catCancel": "{{petSubject}}が近づいてくる間になでると、タブやアプリを開いたままにできます。",
  "petName.toastTitle": "{{petSubject}}が{{closed}}を閉じました",
  "petName.settingsLabel": "名前",
  "petName.settingsDescription": "猫がタブやアプリを閉じたときの通知で、この名前で呼びます。空欄なら「猫」と呼びます。",
  "petName.settingsPlaceholder": "猫",
} as const;

export const PET_NAME_PTBR = {
  "petName.popoverTitle": "Como vamos chamar este gato?",
  "petName.placeholder": "Nome",
  "petName.inputLabel": "Nome do gato",
  "petName.ideas": "Ideias",
  "petName.previewLabel": "Nos avisos",
  "petName.previewEmpty": "Sem nome, é só “o gato”.",
  "petName.later": "Depois",
  "petName.confirm": "Usar este nome",
  "petName.rowUnnamed": "Dar um nome",
  "petName.rowLabel": "Nome",
  "petName.closeDescription": "{{petSubject}} fecha a aba ou o app que está distraindo você quando a distração se repete. O trabalho não salvo pode ser perdido.",
  "petName.catCancel": "Faça carinho em {{petSubject}} durante a aproximação para impedir o fechamento.",
  "petName.toastTitle": "{{petSubject}} fechou {{closed}}",
  "petName.settingsLabel": "Nome",
  "petName.settingsDescription": "Usado quando o gato fecha uma aba ou um app por você. Deixe vazio para chamá-lo de “o gato”.",
  "petName.settingsPlaceholder": "O gato",
} as const;

export const PET_NAME_ZHHANS = {
  "petName.popoverTitle": "给这只猫咪起什么名字？",
  "petName.placeholder": "名字",
  "petName.inputLabel": "猫咪名字",
  "petName.ideas": "推荐",
  "petName.previewLabel": "通知中",
  "petName.previewEmpty": "没有名字时就叫它“猫咪”",
  "petName.later": "稍后",
  "petName.confirm": "就叫这个",
  "petName.rowUnnamed": "起名字",
  "petName.rowLabel": "名字",
  "petName.closeDescription": "反复分心后，{{petSubject}}会关闭让你分心的标签页或应用。未保存的工作可能丢失。",
  "petName.catCancel": "{{petSubject}}走过来时，摸摸它即可让标签页或应用保持打开。",
  "petName.toastTitle": "{{petSubject}}关闭了 {{closed}}",
  "petName.settingsLabel": "名字",
  "petName.settingsDescription": "猫咪替你关闭标签页或应用时，通知里会这样称呼它。留空则叫它“猫咪”。",
  "petName.settingsPlaceholder": "猫咪",
} as const;

export const PET_NAME_FR = {
  "petName.popoverTitle": "Comment allons-nous appeler ce chat ?",
  "petName.placeholder": "Nom",
  "petName.inputLabel": "Nom du chat",
  "petName.ideas": "Idées",
  "petName.previewLabel": "Dans les alertes",
  "petName.previewEmpty": "Sans nom, ce sera simplement « le chat ».",
  "petName.later": "Plus tard",
  "petName.confirm": "Choisir ce nom",
  "petName.rowUnnamed": "Lui donner un nom",
  "petName.rowLabel": "Nom",
  "petName.closeDescription": "{{petSubject}} ferme l’onglet ou l’application qui vous distrait après des distractions répétées. Le travail non enregistré peut être perdu.",
  "petName.catCancel": "Caressez {{petSubject}} pendant son approche pour empêcher la fermeture.",
  "petName.toastTitle": "{{petSubject}} a fermé {{closed}}",
  "petName.settingsLabel": "Nom",
  "petName.settingsDescription": "Utilisé quand le chat ferme un onglet ou une application pour vous. Laissez vide pour l’appeler « le chat ».",
  "petName.settingsPlaceholder": "Le chat",
} as const;

export const PET_NAME_DE = {
  "petName.popoverTitle": "Wie soll diese Katze heißen?",
  "petName.placeholder": "Name",
  "petName.inputLabel": "Name der Katze",
  "petName.ideas": "Ideen",
  "petName.previewLabel": "In Hinweisen",
  "petName.previewEmpty": "Ohne Namen heißt sie einfach „die Katze“.",
  "petName.later": "Später",
  "petName.confirm": "Diesen Namen nehmen",
  "petName.rowUnnamed": "Namen geben",
  "petName.rowLabel": "Name",
  "petName.closeDescription": "{{petSubject}} schließt nach wiederholter Ablenkung den ablenkenden Tab oder die App. Ungespeicherte Arbeit kann verloren gehen.",
  "petName.catCancel": "Streichle {{petSubject}} auf dem Weg dorthin, damit der Tab oder die App geöffnet bleibt.",
  "petName.toastTitle": "{{petSubject}} hat {{closed}} geschlossen",
  "petName.settingsLabel": "Name",
  "petName.settingsDescription": "Wird verwendet, wenn die Katze einen Tab oder eine App für dich schließt. Leer lassen, um sie „die Katze“ zu nennen.",
  "petName.settingsPlaceholder": "Die Katze",
} as const;

/** Three ideas the naming popover offers. None is picked for the user. */
export const PET_NAME_SUGGESTIONS: Readonly<Record<DisplayLanguage, readonly string[]>> = {
  en: ["Mochi", "Miso", "Tofu"],
  ko: ["모모", "보리", "두부"],
  es: ["Luna", "Michi", "Tofu"],
  ja: ["モモ", "タマ", "ミケ"],
  "pt-BR": ["Mia", "Nina", "Tofu"],
  "zh-Hans": ["年糕", "豆腐", "咪咪"],
  fr: ["Minou", "Pistache", "Tofu"],
  de: ["Mimi", "Luna", "Tofu"],
};
