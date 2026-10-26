import { SCREEN_AI_EN, SCREEN_AI_KO, SCREEN_AI_ES, SCREEN_AI_JA, SCREEN_AI_PTBR, SCREEN_AI_ZHHANS, SCREEN_AI_FR, SCREEN_AI_DE } from "./screenAiTranslations";
import { SCREEN_RECORDING_EN, SCREEN_RECORDING_KO } from "./screenRecordingTranslations";

// Shared screen-context copy uses the normal localization dictionaries.
// Keep local retention, exclusion and deletion disclosures identical in scope.

export const SCREEN_CONTEXT_EN = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_EN,
  "screenContext.activityDeleteHint": "If screen recording is on, saved screens from this time are deleted too, and recording pauses until you resume it.",
  "screenContext.state.check": "Check availability",
  "screenContext.sample": "Check a sample in 3 seconds",
  "screenContext.storageFull": "Storage is full. Free up space or delete older screens.",
  "screenContext.trackerNotReady": "Check that activity tracking is running, then try again.",
  "screenContext.activitySource": "Show screens for",
  "screenContext.savedWindow": "Saved screen",
  "screenContext.textNotRequested": "Text was not saved for this screen.",
  "screenContext.textDeadline": "Reading the text took too long, so no text was saved.",
  "screenContext.textUnavailable": "The text could not be checked, so none was saved.",
  "screenContext.noText": "No readable text on this screen."
} as const;

export const SCREEN_CONTEXT_KO = {
  ...SCREEN_RECORDING_KO,
  ...SCREEN_AI_KO,
  "screenContext.activityDeleteHint": "화면 기록을 켰다면 이 시간에 저장한 화면도 함께 지워지고, 다시 시작할 때까지 화면 기록이 멈춰요.",
  "screenContext.state.check": "준비 상태 확인",
  "screenContext.sample": "3초 뒤 샘플 확인",
  "screenContext.storageFull": "저장 공간이 부족해요. 공간을 비우거나 오래된 화면을 지워 주세요.",
  "screenContext.trackerNotReady": "활동 추적이 켜져 있는지 확인한 뒤 다시 시도해 주세요.",
  "screenContext.activitySource": "화면을 볼 활동",
  "screenContext.savedWindow": "저장한 화면",
  "screenContext.textNotRequested": "이 화면은 글자를 저장하지 않았어요.",
  "screenContext.textDeadline": "글자 읽기가 늦어 글자는 저장하지 않았어요.",
  "screenContext.textUnavailable": "글자를 확인하지 못해 저장하지 않았어요.",
  "screenContext.noText": "이 화면에는 읽을 수 있는 글자가 없어요."
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_ES = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_ES,
  "screenContext.activityDeleteHint": "Si hay pruebas de pantalla guardadas en este dispositivo, también se borran las capturas vinculadas y sin vincular, y la captura se pausa hasta que la reanudes.",
  "screenContext.state.check": "Comprobar disponibilidad",
  "screenContext.sample": "Comprobar una muestra en 3 segundos",
  "screenContext.storageFull": "El almacenamiento está lleno. Revisa el estado de captura y libera espacio.",
  "screenContext.trackerNotReady": "Comprueba que el seguimiento de actividad esté en marcha y vuelve a intentarlo.",
  "screenContext.activitySource": "Actividad para la evidencia de pantalla",
  "screenContext.savedWindow": "Ventana activa guardada",
  "screenContext.textNotRequested": "No se eligió leer texto para este registro.",
  "screenContext.textDeadline": "La lectura tardó demasiado y no se guardó texto.",
  "screenContext.textUnavailable": "No se pudo verificar el texto y no se guardó.",
  "screenContext.noText": "No se encontró texto legible."
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_JA = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_JA,
  "screenContext.activityDeleteHint": "このデバイスに画面の記録がある場合、関連付けられた画面と未関連の画面も削除し、手動で再開するまで画面キャプチャを一時停止します。",
  "screenContext.state.check": "利用状況を確認",
  "screenContext.sample": "3秒後にサンプルを確認",
  "screenContext.storageFull": "保存容量が不足しています。キャプチャの状態を確認し、空き容量を確保してください。",
  "screenContext.trackerNotReady": "アクティビティの記録が実行中か確認してから、もう一度お試しください。",
  "screenContext.activitySource": "画面記録のアクティビティ",
  "screenContext.savedWindow": "保存したアクティブウインドウ",
  "screenContext.textNotRequested": "この記録では文字の読み取りを選択していません。",
  "screenContext.textDeadline": "読み取りに時間がかかったため、文字は保存しませんでした。",
  "screenContext.textUnavailable": "文字を確認できなかったため、文字は保存しませんでした。",
  "screenContext.noText": "読み取れる文字が見つかりませんでした。"
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_PTBR = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_PTBR,
  "screenContext.activityDeleteHint": "Se houver evidências de tela salvas neste dispositivo, as capturas vinculadas e sem vínculo também serão apagadas, e a captura ficará pausada até você retomá-la.",
  "screenContext.state.check": "Verificar disponibilidade",
  "screenContext.sample": "Verificar uma amostra em 3 segundos",
  "screenContext.storageFull": "O armazenamento está cheio. Verifique o estado da captura e libere espaço.",
  "screenContext.trackerNotReady": "Verifique se o registro de atividades está em execução e tente novamente.",
  "screenContext.activitySource": "Atividade para evidências de tela",
  "screenContext.savedWindow": "Janela ativa salva",
  "screenContext.textNotRequested": "A leitura de texto não foi selecionada para este registro.",
  "screenContext.textDeadline": "A leitura demorou demais, então nenhum texto foi salvo.",
  "screenContext.textUnavailable": "O texto não pôde ser verificado, então nenhum texto foi salvo.",
  "screenContext.noText": "Nenhum texto legível foi encontrado."
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_ZHHANS = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_ZHHANS,
  "screenContext.activityDeleteHint": "如果此设备保存了屏幕依据，相关联和尚未关联的截图也会被删除，屏幕采集会暂停，直到你手动恢复。",
  "screenContext.state.check": "检查可用状态",
  "screenContext.sample": "3秒后检查样本",
  "screenContext.storageFull": "存储空间已满。请检查捕获状态并释放空间。",
  "screenContext.trackerNotReady": "请确认活动追踪正在运行，然后重试。",
  "screenContext.activitySource": "屏幕记录所属活动",
  "screenContext.savedWindow": "已保存的活动窗口",
  "screenContext.textNotRequested": "此记录未选择文字读取。",
  "screenContext.textDeadline": "文字读取超时，因此未保存文字。",
  "screenContext.textUnavailable": "无法验证文字，因此未保存文字。",
  "screenContext.noText": "未找到可读文字。"
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_FR = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_FR,
  "screenContext.activityDeleteHint": "Si des preuves d’écran sont enregistrées sur cet appareil, les captures liées et non liées sont aussi effacées, et la capture reste en pause jusqu’à sa reprise manuelle.",
  "screenContext.state.check": "Vérifier la disponibilité",
  "screenContext.sample": "Vérifier un échantillon dans 3 secondes",
  "screenContext.storageFull": "Le stockage est plein. Vérifiez l’état de la capture et libérez de l’espace.",
  "screenContext.trackerNotReady": "Vérifiez que le suivi d’activité est en cours, puis réessayez.",
  "screenContext.activitySource": "Activité des preuves d’écran",
  "screenContext.savedWindow": "Fenêtre active sauvegardée",
  "screenContext.textNotRequested": "La lecture du texte n’a pas été sélectionnée pour cet enregistrement.",
  "screenContext.textDeadline": "La lecture a pris trop de temps ; aucun texte n’a été sauvegardé.",
  "screenContext.textUnavailable": "Le texte n’a pas pu être vérifié ; aucun texte n’a été sauvegardé.",
  "screenContext.noText": "Aucun texte lisible n’a été trouvé."
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;

export const SCREEN_CONTEXT_DE = {
  ...SCREEN_RECORDING_EN,
  ...SCREEN_AI_DE,
  "screenContext.activityDeleteHint": "Falls Bildschirmbelege auf diesem Gerät gespeichert sind, werden auch verknüpfte und noch nicht verknüpfte Aufnahmen gelöscht. Die Aufnahme bleibt pausiert, bis du sie fortsetzt.",
  "screenContext.state.check": "Verfügbarkeit prüfen",
  "screenContext.sample": "In 3 Sekunden eine Aufnahme prüfen",
  "screenContext.storageFull": "Der Speicher ist voll. Prüfe den Aufnahmestatus und gib Speicher frei.",
  "screenContext.trackerNotReady": "Prüfe, ob die Aktivitätserfassung läuft, und versuche es erneut.",
  "screenContext.activitySource": "Aktivität für Bildschirmbelege",
  "screenContext.savedWindow": "Gespeichertes aktives Fenster",
  "screenContext.textNotRequested": "Für diese Aufzeichnung wurde kein Textlesen ausgewählt.",
  "screenContext.textDeadline": "Das Lesen dauerte zu lange, daher wurde kein Text gespeichert.",
  "screenContext.textUnavailable": "Der Text konnte nicht geprüft werden, daher wurde kein Text gespeichert.",
  "screenContext.noText": "Kein lesbarer Text gefunden."
} as const satisfies Record<keyof typeof SCREEN_CONTEXT_EN, string>;
