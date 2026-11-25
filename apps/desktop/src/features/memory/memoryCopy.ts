import type { MemoryWikiPage } from "../screen-context/memoryWire";
import type { WikiKind } from "./memoryWikiModel";

/** Bundle IDs the wiki records, shown by their app names. */
export const APP_NAMES: Record<string, string> = { "com.apple.TextEdit": "TextEdit", "com.apple.Preview": "Preview", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack", "com.hnc.Discord": "Discord", "com.todesktop.230313mzl4w4u92": "Cursor", "com.openai.codex": "ChatGPT", "com.cmuxterm.app": "cmux", "com.microsoft.Powerpoint": "PowerPoint", "at.studio.AsideBrowser": "Aside", "com.google.Chrome": "Chrome",
  "com.apple.Safari": "Safari", "com.apple.Notes": "Notes", "com.apple.mail": "Mail", "com.apple.iWork.Pages": "Pages", "com.apple.iWork.Keynote": "Keynote", "com.apple.iWork.Numbers": "Numbers",
  "com.apple.Terminal": "Terminal", "com.microsoft.Word": "Word", "com.microsoft.Excel": "Excel", "com.microsoft.Outlook": "Outlook", "com.microsoft.teams2": "Teams" };
/** Bundle ID parts that name a platform or a vendor's channel rather than the app. */
const GENERIC_PARTS = new Set(["app", "id", "mac", "macos", "osx", "desktop", "client", "electron", "beta", "stable", "release", "com", "io", "org", "net", "co"]);

/** An app's name: a known one, or a readable guess from its bundle ID, since memory reads every app. */
export function appName(app: string): string {
  const known = APP_NAMES[app];
  if (known) return known;
  const part = app.split(".").reverse().find((piece) => /[a-z]/i.test(piece) && !GENERIC_PARTS.has(piece.toLowerCase()));
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : app;
}

const DAY = 86_400_000;
function dayStart(ms: number): number {
  const day = new Date(ms); day.setHours(0, 0, 0, 0); return day.getTime();
}

/**
 * One vocabulary for every view. A remembered sentence is a "memory"; a
 * stretch of work is a "session" in the flow; a page gathers the memories
 * about one project, person or topic. Only "updated today" is marked in colour.
 */
export const MEMORY_COPY = {
  ko: {
    nav: "기억", title: "기억", views: "보기", flow: "흐름", pages: "페이지", graph: "그래프", manage: "관리", settings: "기억 설정",
    kinds: { project: "프로젝트", person: "사람", topic: "주제" } as Record<WikiKind, string>,
    groups: { project: "프로젝트", person: "사람", topic: "주제" } as Record<WikiKind, string>,
    pageList: "페이지 목록", sessionList: "작업 흐름", search: "기억 검색", findPlaceholder: "기억에서 찾기", noMatch: "맞는 페이지가 없어요.", noSession: "맞는 작업이 없어요.",
    railEdge: "목록 폭 조절",
    nowTitle: "지금", nowDoing: "하고 있는 일", nowWaiting: "기다리는 일", nowDone: "최근 끝낸 일",
    meTitle: "나에 대해", meRole: "하는 일", meOwns: "맡고 있는 일", mePeople: "함께 일하는 사람",
    meUpdated: (time: string) => time + " 정리 · 최근 2주 기억으로 하루에 한 번 다시 써요",
    myNote: "내 메모", myNoteAdd: "내 메모 추가", myNoteEdit: "메모 고치기",
    myNotePlaceholder: "이 페이지에 덧붙일 생각이나 할 일을 적어 두세요. 자동 정리는 이 메모를 바꾸지 않아요.",
    myNoteSave: "저장", myNoteSaved: "메모를 저장했어요.", myNoteCleared: "메모를 지웠어요.",
    myNoteUpdated: (time: string) => time + " 수정", myNoteLimit: (left: number) => left + "자 남음",
    nowUpdated: (time: string) => time + " 정리",
    off: "자동 기억 꺼짐", trackingPaused: "추적 일시정지 중 · 저장된 기억 보기",
    turnOn: "켜기", unsupported: "이 컴퓨터에서는 자동 기억을 쓸 수 없어요.",
    loading: "기억을 불러오는 중…", failed: "기억을 불러오지 못했어요.", retry: "다시 시도",
    recordingStopped: "화면 기록이 꺼져 있거나 멈춰 있어서 기억을 불러오지 못했어요.", openRecording: "화면 기록 설정",
    startTitle: "일하는 동안 본 내용을\u00a0자동으로 정리해 둬요",
    startBody: ["보이는 창을 읽어 작업 흐름과 페이지로 정리해요.", "메모를 따로 쓸 필요가 없어요."] as readonly string[],
    startAction: "자동 기억 시작하기",
    startSize: (mb: number) => "처음 한 번 약 " + mb + "MB를 받아요",
    setupEngine: "기억 엔진 받기", setupModels: "검색 모델 받기", setupKey: "AI 연결", setupPermission: "화면 기록 허용",
    setupSize: (mb: number) => mb + "MB", setupProgress: (received: number, total: number) => received + " / " + total + "MB",
    startVerifying: "확인 중", startTurningOn: "기억을 켜는 중이에요",
    startRemaining: (seconds: number) => seconds < 50 ? "약 " + Math.max(5, Math.ceil(seconds / 5) * 5) + "초 남았어요" : "약 " + Math.ceil(seconds / 60) + "분 남았어요",
    startFailed: "내려받지 못했어요", startError: "시작하지 못했어요",
    startPermission: "허용하기", setupPermissionHint: "허용하면 Drifty가 한 번 다시 열려요.",
    startKey: "연결하기", startKeyCaption: "체험이나 Pro에서는 키 없이 쓸 수 있어요",
    startOnTitle: "기억을 켰어요", startOnBody: ["하던 일로 돌아가 평소처럼 일하세요.", "첫 기억은 보통 1–2분 뒤 여기에 나타나요."] as readonly string[],
    onRead: "화면 읽기", onReadWaiting: "다른 앱을 쓰면 시작해요", onReadCount: (count: number) => "화면 " + count + "개",
    onFirst: "첫 기억 정리", onFirstActive: "정리하는 중",
    startModelLoading: "검색 모델을 처음 한 번 내려받는 중이에요 · 약 255MB",
    startUnsupportedTitle: "이 Mac에서는 아직 쓸 수 없어요", startUnsupportedBody: ["Apple Silicon Mac,", "macOS 14 이상에서 쓸 수 있어요."] as readonly string[],
    clock: (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    day: (ms: number, now: Date) => {
      const date = new Date(ms).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }).replace(/\((.)\)/, "$1");
      const today = dayStart(now.getTime());
      return ms >= today ? "오늘 · " + date : ms >= today - DAY ? "어제 · " + date : date;
    },
    dayShort: (ms: number, now: Date) => {
      const today = dayStart(now.getTime());
      return ms >= today ? "오늘" : ms >= today - DAY ? "어제" : new Date(ms).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
    },
    sessions: (count: number) => "작업 " + count,
    periods: { today: "오늘", week: "이번 주", all: "전체" },
    period: "기간",
    remembered: "여기서 기억한 것",
    originals: "원본 화면",
    changed: "바뀜", changedLater: "이후 바뀜",
    openSession: (title: string) => "작업 열기: " + title,
    updated: (time: string) => time + " 업데이트", lines: (count: number) => "기억 " + count + "개",
    updatedToday: "오늘 업데이트", earlier: (count: number) => "이전 내용 " + count + "개",
    ask: "채팅에서 묻기", openPage: "페이지 열기", showInGraph: "그래프에서 보기", allPages: "모든 페이지",
    deletePage: "페이지 삭제", deleteLine: "이 기억 지우기", deleteShort: "삭제",
    confirmPage: (title: string) => "‘" + title + "’ 페이지를 지울까요? 원본 화면과 활동 기록은 남아요.",
    confirmDelete: "지우기", cancel: "취소",
    original: "원본 보기", orphans: "교체된 이전 내용", replacedAt: (time: string) => time + "에 교체",
    linked: "이어진 페이지", content: "기억",
    lineDetail: "기억 상세", closeDetail: "상세 닫기",
    history: "변경 이력",
    originalKept: (hours: number) => hours === 0 ? "원본 글자는 직접 지울 때까지 보관돼요. 화면 이미지는 저장한 화면의 보관 기간을 따라요."
      : "원본 글자는 " + (hours > 24 && hours % 24 === 0 ? hours / 24 + "일" : hours + "시간") + " 동안 보관돼요. 화면 이미지는 저장한 화면의 보관 기간을 따라요.",
    originalGone: "원본은 보관 기간이 지나 지워졌어요.",
    filters: "기억 거르기", filterAll: "전체", filterToday: "오늘", filterEarlier: "이전 내용 있음",
    colText: "내용", colPage: "페이지", colSource: "출처", colTime: "시각",
    selectLine: (text: string) => "선택: " + text, selectAll: "보이는 기억 모두 선택",
    selected: (count: number) => count + "개 선택됨", clearSelection: "선택 해제",
    confirmLines: (count: number) => count + "개를 지울까요? 원본 화면은 그대로예요.",
    linesDeleted: (count: number) => count + "개를 지웠어요. 원본 화면은 그대로예요.", listEmpty: "맞는 기억이 없어요.",
    directLinks: (count: number) => "직접 연결 " + count + "개",
    graphLabel: (pages: number, links: number) => "페이지 " + pages + "개와 연결 " + links + "개로 된 기억 그래프",
    zoomIn: "확대", zoomOut: "축소", zoomFit: "전체 보기", closePanel: "닫기", more: "더 보기", back: "뒤로", forward: "앞으로", resizePanel: "문서 너비 조절",
    replay: "리플레이", replayHint: "페이지가 생긴 순서대로 그래프 다시 보기", replayStop: "리플레이 멈추기",
    evidence: "근거", pending: "새로 들어온 기억",
    cite: (number: number) => "근거 " + number + " 보기", goneLink: (title: string) => title + " 페이지는 지워졌어요",
    copyMarkdown: "마크다운으로 복사", copied: "마크다운으로 복사했어요.", copyFailed: "복사하지 못했어요.",
    exact: (ms: number) => new Date(ms).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }),
    lineDeleted: "기억을 지웠어요. 원본 화면은 그대로예요.", pageDeleted: "페이지를 지웠어요.", forgotten: "이 출처의 기억을 잊었어요.",
    changeFailed: "변경하지 못했어요. 잠시 뒤 다시 시도해 주세요.", viewerTitle: "기억의 원본",
    originalTextOnly: "화면 이미지는 더 이상 보관하지 않고, 읽은 글자만 남아 있어요.", forgetOriginal: "이 출처의 기억 잊기", closeOriginal: "닫기",
    askPrompt: (page: MemoryWikiPage) => page.kind === "person" ? page.title + "와 관련해서 최근에 무슨 일이 있었는지 알려줘"
      : page.kind === "topic" ? page.title + "에 대해 기억하는 내용을 정리해줘" : page.title + " 지금 상태가 어때?",
  },
  en: {
    nav: "Memory", title: "Work memory", views: "View", flow: "Flow", pages: "Pages", graph: "Graph", manage: "Manage", settings: "Memory settings",
    kinds: { project: "Project", person: "Person", topic: "Topic" } as Record<WikiKind, string>,
    groups: { project: "Projects", person: "People", topic: "Topics" } as Record<WikiKind, string>,
    pageList: "Pages", sessionList: "Work flow", search: "Search memory", findPlaceholder: "Find in memory", noMatch: "No matching pages.", noSession: "No matching sessions.",
    railEdge: "Resize list",
    nowTitle: "Now", nowDoing: "In progress", nowWaiting: "Waiting on", nowDone: "Recently done",
    meTitle: "About me", meRole: "What I do", meOwns: "What I lead", mePeople: "Who I work with",
    meUpdated: (time: string) => "Written " + time + " · rewritten daily from the last two weeks of memories",
    myNote: "My note", myNoteAdd: "Add my note", myNoteEdit: "Edit note",
    myNotePlaceholder: "Your own thoughts or to-dos for this page. Automatic rewrites never change this note.",
    myNoteSave: "Save", myNoteSaved: "Note saved.", myNoteCleared: "Note removed.",
    myNoteUpdated: (time: string) => "Edited " + time, myNoteLimit: (left: number) => left + " characters left",
    nowUpdated: (time: string) => "Written " + time,
    off: "Automatic memory off", trackingPaused: "Tracking paused · Showing saved memory",
    turnOn: "Turn on", unsupported: "Automatic memory isn’t available on this computer.",
    loading: "Loading memory…", failed: "Couldn’t load memory.", retry: "Try again",
    recordingStopped: "Screen recording is off or paused, so memory couldn’t load.", openRecording: "Screen recording settings",
    startTitle: "Keep what you saw while working, organized for you",
    startBody: ["Drifty reads the windows you see and organizes them into a flow and pages.", "No notes required."] as readonly string[],
    startAction: "Start automatic memory",
    startSize: (mb: number) => "Downloads about " + mb + " MB once",
    setupEngine: "Download the memory engine", setupModels: "Download the search model", setupKey: "AI connection", setupPermission: "Allow screen recording",
    setupSize: (mb: number) => mb + " MB", setupProgress: (received: number, total: number) => received + " / " + total + " MB",
    startVerifying: "Checking", startTurningOn: "Turning memory on",
    startRemaining: (seconds: number) => seconds < 50 ? "About " + Math.max(5, Math.ceil(seconds / 5) * 5) + " sec left" : "About " + Math.ceil(seconds / 60) + " min left",
    startFailed: "Couldn’t download", startError: "Couldn’t start",
    startPermission: "Allow", setupPermissionHint: "Drifty reopens once after you allow it.",
    startKey: "Connect", startKeyCaption: "No key needed with a trial or Pro",
    startOnTitle: "Memory is on", startOnBody: ["Go back to what you were doing and work as usual.", "Your first memory usually appears here in 1–2 minutes."] as readonly string[],
    onRead: "Read screens", onReadWaiting: "Starts when you use another app", onReadCount: (count: number) => count === 1 ? "1 screen" : count + " screens",
    onFirst: "First memory", onFirstActive: "Organizing",
    startModelLoading: "Downloading the search model once · about 255 MB",
    startUnsupportedTitle: "Not available on this Mac yet", startUnsupportedBody: ["Works on Apple Silicon Macs", "with macOS 14 or later."] as readonly string[],
    clock: (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    day: (ms: number, now: Date) => {
      const date = new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const today = dayStart(now.getTime());
      return ms >= today ? "Today · " + date : ms >= today - DAY ? "Yesterday · " + date : date;
    },
    dayShort: (ms: number, now: Date) => {
      const today = dayStart(now.getTime());
      return ms >= today ? "Today" : ms >= today - DAY ? "Yesterday" : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    sessions: (count: number) => count === 1 ? "1 session" : count + " sessions",
    periods: { today: "Today", week: "This week", all: "All" },
    period: "Period",
    remembered: "Remembered here",
    originals: "Original screens",
    changed: "Changed", changedLater: "Changed since",
    openSession: (title: string) => "Open session: " + title,
    updated: (time: string) => "Updated " + time, lines: (count: number) => count === 1 ? "1 memory" : count + " memories",
    updatedToday: "Updated today", earlier: (count: number) => count === 1 ? "1 earlier version" : count + " earlier versions",
    ask: "Ask in Chat", openPage: "Open page", showInGraph: "Show in graph", allPages: "All pages",
    deletePage: "Delete page", deleteLine: "Delete this memory", deleteShort: "Delete",
    confirmPage: (title: string) => "Delete the “" + title + "” page? Original screens and activity stay.",
    confirmDelete: "Delete", cancel: "Cancel",
    original: "View original", orphans: "Earlier, replaced memories", replacedAt: (time: string) => "replaced " + time,
    linked: "Linked pages", content: "Memories",
    lineDetail: "Memory details", closeDetail: "Close details",
    history: "History",
    originalKept: (hours: number) => hours === 0 ? "The original text is kept until you delete it. Screen images follow the Saved screens period."
      : "The original text is kept for " + (hours > 24 && hours % 24 === 0 ? hours / 24 + " days" : hours + (hours === 1 ? " hour" : " hours")) + ". Screen images follow the Saved screens period.",
    originalGone: "The original was deleted after its retention period.",
    filters: "Filter memories", filterAll: "All", filterToday: "Today", filterEarlier: "Has earlier versions",
    colText: "Memory", colPage: "Page", colSource: "Source", colTime: "Time",
    selectLine: (text: string) => "Select: " + text, selectAll: "Select all visible memories",
    selected: (count: number) => count === 1 ? "1 selected" : count + " selected", clearSelection: "Clear selection",
    confirmLines: (count: number) => (count === 1 ? "Delete 1 memory?" : "Delete " + count + " memories?") + " Original screens stay.",
    linesDeleted: (count: number) => (count === 1 ? "1 memory deleted." : count + " memories deleted.") + " Original screens stay.", listEmpty: "No matching memories.",
    directLinks: (count: number) => count + " direct links",
    graphLabel: (pages: number, links: number) => "Memory graph of " + pages + " pages and " + links + " links",
    zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit to view", closePanel: "Close", more: "More", back: "Back", forward: "Forward", resizePanel: "Resize document",
    replay: "Replay", replayHint: "Replay the graph in the order its pages began", replayStop: "Stop the replay",
    evidence: "Evidence", pending: "Newly remembered",
    cite: (number: number) => "Show evidence " + number, goneLink: (title: string) => "The " + title + " page was deleted",
    copyMarkdown: "Copy as Markdown", copied: "Copied as Markdown.", copyFailed: "Couldn’t copy.",
    exact: (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    lineDeleted: "Memory deleted. The original screen stays.", pageDeleted: "Page deleted.", forgotten: "Memories from this source were forgotten.",
    changeFailed: "Couldn’t make the change. Try again in a moment.", viewerTitle: "Memory source",
    originalTextOnly: "The screen image is no longer kept; the text read from it remains.", forgetOriginal: "Forget this source’s memories", closeOriginal: "Close",
    askPrompt: (page: MemoryWikiPage) => page.kind === "person" ? "What has happened recently with " + page.title + "?"
      : page.kind === "topic" ? "Summarize what you remember about " + page.title + "." : "What is the current status of " + page.title + "?",
  },
};
export type MemoryCopy = typeof MEMORY_COPY.ko;
